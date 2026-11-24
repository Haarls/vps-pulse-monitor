import { createServer as createHttpServer } from 'node:http';
import { createServer as createTcpServer, type AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { dispatchWebhookAlert } from '../src/alerter.js';
import { TargetsListSchema } from '../src/config.js';
import { probeAll } from '../src/prober.js';
import { PulseStore } from '../src/store.js';

const stores: PulseStore[] = [];
const createMemoryStore = () => {
  const s = new PulseStore(':memory:');
  stores.push(s);
  return s;
};

afterEach(() => {
  while (stores.length > 0) stores.pop()?.close();
});

describe('vps-pulse-monitor', () => {
  it('computes 24h p50, p95, and uptime directly in SQLite while excluding stale and failed latencies', () => {
    const store = createMemoryStore();
    const now = '2026-11-23T22:00:00.000Z';
    const base = {
      targetName: 'core-api',
      targetType: 'http' as const,
      endpoint: 'https://api.example.com/health',
    };

    // Out-of-window check (26h ago) — ignored by 24h window
    store.recordCheck({
      ...base,
      statusCode: 500,
      latencyMs: 999,
      isUp: false,
      errorMessage: 'HTTP 500',
      checkedAt: '2026-11-22T20:00:00.000Z',
    });

    for (let i = 1; i <= 20; i++) {
      store.recordCheck({
        ...base,
        statusCode: 200,
        latencyMs: i * 10,
        isUp: true,
        errorMessage: null,
        checkedAt: new Date(Date.parse(now) - (25 - i) * 60_000).toISOString(),
      });
    }
    for (let j = 1; j <= 5; j++) {
      store.recordCheck({
        ...base,
        statusCode: null,
        latencyMs: 0.2,
        isUp: false,
        errorMessage: 'ECONNREFUSED',
        checkedAt: new Date(Date.parse(now) - j * 10_000).toISOString(),
      });
    }

    const [metric] = store.getMetrics24h(now);
    expect(metric).toMatchObject({
      totalChecks24h: 25,
      uptimePct24h: 80,
      p50Ms: 100,
      p95Ms: 190,
      isUp: false,
    });
  });

  it('deduplicates state-change transitions (UP -> DOWN -> DOWN -> UP) and formats webhook payloads', async () => {
    const store = createMemoryStore();
    const base = {
      targetName: 'pg-bouncer',
      targetType: 'tcp' as const,
      endpoint: '10.0.0.12:6432',
      statusCode: null,
    };

    expect(
      store.recordCheck({
        ...base,
        latencyMs: 1.4,
        isUp: true,
        errorMessage: null,
        checkedAt: '2026-11-23T21:00:00.000Z',
      }),
    ).toBeNull();
    expect(
      store.recordCheck({
        ...base,
        latencyMs: 1.6,
        isUp: true,
        errorMessage: null,
        checkedAt: '2026-11-23T21:00:30.000Z',
      }),
    ).toBeNull();

    const downEvent = store.recordCheck({
      ...base,
      latencyMs: 0.3,
      isUp: false,
      errorMessage: 'connect ECONNREFUSED 10.0.0.12:6432',
      checkedAt: '2026-11-23T21:01:00.000Z',
    });
    expect(downEvent?.eventType).toBe('DOWN');
    expect(
      store.recordCheck({
        ...base,
        latencyMs: 0.3,
        isUp: false,
        errorMessage: 'connect ECONNREFUSED 10.0.0.12:6432',
        checkedAt: '2026-11-23T21:01:30.000Z',
      }),
    ).toBeNull();

    const recovered = store.recordCheck({
      ...base,
      latencyMs: 1.9,
      isUp: true,
      errorMessage: null,
      checkedAt: '2026-11-23T21:02:30.000Z',
    });
    expect(recovered).toMatchObject({ eventType: 'RECOVERED', durationSec: 90 });

    const bodies: Array<{ text: string; content: string }> = [];
    const sent = await dispatchWebhookAlert(
      'https://hooks.example.internal/ops',
      recovered!,
      async (_u, init) => {
        bodies.push(JSON.parse(String(init?.body)) as { text: string; content: string });
        return new Response('ok', { status: 200 });
      },
    );

    expect(sent).toBe(true);
    expect(bodies[0]?.text).toContain('[RECOVERED] pg-bouncer');
    expect(bodies[0]?.content).toBe(bodies[0]?.text);
  });

  it('probes live local HTTP and TCP endpoints concurrently', async () => {
    const httpSrv = createHttpServer((_req, res) => {
      res.writeHead(204);
      res.end();
    });
    const tcpSrv = createTcpServer((s) => s.end());
    await new Promise<void>((r) => httpSrv.listen(0, '127.0.0.1', r));
    await new Promise<void>((r) => tcpSrv.listen(0, '127.0.0.1', r));

    try {
      const checks = await probeAll([
        {
          name: 'local-http-204',
          type: 'http',
          url: `http://127.0.0.1:${(httpSrv.address() as AddressInfo).port}/ping`,
          intervalSeconds: 10,
          timeoutMs: 1000,
          expectedStatus: 204,
        },
        {
          name: 'local-tcp-open',
          type: 'tcp',
          host: '127.0.0.1',
          port: (tcpSrv.address() as AddressInfo).port,
          intervalSeconds: 10,
          timeoutMs: 1000,
        },
      ]);
      expect(checks).toHaveLength(2);
      expect(checks[0]).toMatchObject({ isUp: true, statusCode: 204 });
      expect(checks[1]?.isUp).toBe(true);
    } finally {
      httpSrv.close();
      tcpSrv.close();
    }
  });

  it('rejects duplicate target names in targets.json validation', () => {
    const res = TargetsListSchema.safeParse([
      {
        name: 'dup',
        type: 'tcp',
        host: '127.0.0.1',
        port: 80,
        intervalSeconds: 10,
        timeoutMs: 500,
      },
      {
        name: 'dup',
        type: 'tcp',
        host: '127.0.0.1',
        port: 443,
        intervalSeconds: 10,
        timeoutMs: 500,
      },
    ]);
    expect(res.success).toBe(false);
  });
});
