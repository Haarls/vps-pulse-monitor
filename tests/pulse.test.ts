import { createServer as createHttpServer } from 'node:http';
import { createServer as createTcpServer, type AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { dispatchWebhookAlert } from '../src/alerter.js';
import { TargetsListSchema } from '../src/config.js';
import { probeAll } from '../src/prober.js';
import { PulseStore } from '../src/store.js';

const stores: PulseStore[] = [];

function createMemoryStore(): PulseStore {
  const s = new PulseStore(':memory:');
  stores.push(s);
  return s;
}

afterEach(() => {
  while (stores.length > 0) {
    stores.pop()?.close();
  }
});

describe('vps-pulse-monitor', () => {
  it('computes 24h p50, p95, and uptime directly in SQLite while excluding stale and failed latencies', () => {
    const store = createMemoryStore();
    const now = '2026-11-23T22:00:00.000Z';

    // Out-of-window check (26h ago) — must be ignored by 24h window
    store.recordCheck({
      targetName: 'core-api',
      targetType: 'http',
      endpoint: 'https://api.example.com/health',
      statusCode: 500,
      latencyMs: 999,
      isUp: false,
      errorMessage: 'HTTP 500',
      checkedAt: '2026-11-22T20:00:00.000Z',
    });

    // 20 healthy checks within 24h with latencies 10ms, 20ms, ..., 200ms
    for (let i = 1; i <= 20; i++) {
      const ts = new Date(Date.parse(now) - (25 - i) * 60_000).toISOString();
      store.recordCheck({
        targetName: 'core-api',
        targetType: 'http',
        endpoint: 'https://api.example.com/health',
        statusCode: 200,
        latencyMs: i * 10,
        isUp: true,
        errorMessage: null,
        checkedAt: ts,
      });
    }

    // 5 failed ECONNREFUSED checks (0.2ms) within 24h -> total 25 checks, 20 UP = 80.00% uptime
    for (let j = 1; j <= 5; j++) {
      const ts = new Date(Date.parse(now) - j * 10_000).toISOString();
      store.recordCheck({
        targetName: 'core-api',
        targetType: 'http',
        endpoint: 'https://api.example.com/health',
        statusCode: null,
        latencyMs: 0.2,
        isUp: false,
        errorMessage: 'ECONNREFUSED',
        checkedAt: ts,
      });
    }

    const [metric] = store.getMetrics24h(now);
    expect(metric).toBeDefined();
    expect(metric?.totalChecks24h).toBe(25);
    expect(metric?.uptimePct24h).toBe(80);
    // Nearest-rank over the 20 UP samples (10..200): 50th = 10th item (100ms), 95th = 19th item (190ms)
    expect(metric?.p50Ms).toBe(100);
    expect(metric?.p95Ms).toBe(190);
    expect(metric?.isUp).toBe(false);
  });

  it('deduplicates state-change transitions (UP -> DOWN -> DOWN -> UP) and formats webhook payloads', async () => {
    const store = createMemoryStore();
    const base = {
      targetName: 'pg-bouncer',
      targetType: 'tcp' as const,
      endpoint: '10.0.0.12:6432',
      statusCode: null,
    };

    // Initial UP boot -> silent baseline
    expect(
      store.recordCheck({
        ...base,
        latencyMs: 1.4,
        isUp: true,
        errorMessage: null,
        checkedAt: '2026-11-23T21:00:00.000Z',
      }),
    ).toBeNull();

    // Steady UP -> silent
    expect(
      store.recordCheck({
        ...base,
        latencyMs: 1.6,
        isUp: true,
        errorMessage: null,
        checkedAt: '2026-11-23T21:00:30.000Z',
      }),
    ).toBeNull();

    // Transition UP -> DOWN -> emits DOWN alert once
    const downEvent = store.recordCheck({
      ...base,
      latencyMs: 0.3,
      isUp: false,
      errorMessage: 'connect ECONNREFUSED 10.0.0.12:6432',
      checkedAt: '2026-11-23T21:01:00.000Z',
    });
    expect(downEvent?.eventType).toBe('DOWN');

    // Repeated DOWN -> deduplicated (null)
    expect(
      store.recordCheck({
        ...base,
        latencyMs: 0.3,
        isUp: false,
        errorMessage: 'connect ECONNREFUSED 10.0.0.12:6432',
        checkedAt: '2026-11-23T21:01:30.000Z',
      }),
    ).toBeNull();

    // Recovery DOWN -> UP after 90s -> emits RECOVERED with durationSec=90
    const recoveredEvent = store.recordCheck({
      ...base,
      latencyMs: 1.9,
      isUp: true,
      errorMessage: null,
      checkedAt: '2026-11-23T21:02:30.000Z',
    });
    expect(recoveredEvent?.eventType).toBe('RECOVERED');
    expect(recoveredEvent?.durationSec).toBe(90);

    const webhookBodies: Array<{ text: string; content: string }> = [];
    const sent = await dispatchWebhookAlert(
      'https://hooks.example.internal/ops',
      recoveredEvent!,
      async (_url, init) => {
        webhookBodies.push(JSON.parse(String(init?.body)) as { text: string; content: string });
        return new Response('ok', { status: 200 });
      },
    );

    expect(sent).toBe(true);
    expect(webhookBodies[0]?.text).toContain('[RECOVERED] pg-bouncer');
    expect(webhookBodies[0]?.content).toBe(webhookBodies[0]?.text);
  });

  it('probes live local HTTP and TCP endpoints concurrently', async () => {
    const httpSrv = createHttpServer((_req, res) => {
      res.writeHead(204);
      res.end();
    });
    const tcpSrv = createTcpServer((socket) => socket.end());

    await new Promise<void>((r) => httpSrv.listen(0, '127.0.0.1', r));
    await new Promise<void>((r) => tcpSrv.listen(0, '127.0.0.1', r));

    const httpPort = (httpSrv.address() as AddressInfo).port;
    const tcpPort = (tcpSrv.address() as AddressInfo).port;

    try {
      const checks = await probeAll([
        {
          name: 'local-http-204',
          type: 'http',
          url: `http://127.0.0.1:${httpPort}/ping`,
          intervalSeconds: 10,
          timeoutMs: 1000,
          expectedStatus: 204,
        },
        {
          name: 'local-tcp-open',
          type: 'tcp',
          host: '127.0.0.1',
          port: tcpPort,
          intervalSeconds: 10,
          timeoutMs: 1000,
        },
      ]);

      expect(checks).toHaveLength(2);
      expect(checks[0]?.isUp).toBe(true);
      expect(checks[0]?.statusCode).toBe(204);
      expect(checks[1]?.isUp).toBe(true);
    } finally {
      httpSrv.close();
      tcpSrv.close();
    }
  });

  it('rejects duplicate target names in targets.json validation', () => {
    const res = TargetsListSchema.safeParse([
      { name: 'dup', type: 'tcp', host: '127.0.0.1', port: 80, intervalSeconds: 10, timeoutMs: 500 },
      { name: 'dup', type: 'tcp', host: '127.0.0.1', port: 443, intervalSeconds: 10, timeoutMs: 500 },
    ]);
    expect(res.success).toBe(false);
  });
});
