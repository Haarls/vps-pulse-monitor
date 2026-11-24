#!/usr/bin/env node
import path from 'node:path';
import { dispatchWebhookAlert, formatAlertMessage } from './alerter.js';
import { loadTargets } from './config.js';
import { probeAll, probeTarget, type CheckRecord } from './prober.js';
import { createDashboardServer } from './server.js';
import { PulseStore } from './store.js';

function readArg(flag: string): string | undefined {
  const idx = process.argv.indexOf(flag);
  return idx !== -1 ? process.argv[idx + 1] : undefined;
}

async function main(): Promise<void> {
  const once = process.argv.includes('--once');
  const configPath = path.resolve(readArg('--config') ?? './targets.json');
  const dbPath = path.resolve(readArg('--db') ?? process.env.PULSE_DB_PATH ?? './pulse.db');
  const port = Number(readArg('--port') ?? process.env.PULSE_PORT ?? 4080);
  const webhookUrl = process.env.ALERT_WEBHOOK_URL;

  const targets = loadTargets(configPath);
  const store = new PulseStore(dbPath);

  const ingestCheck = async (check: CheckRecord) => {
    const transition = store.recordCheck(check);
    if (!transition) return;
    console.log(formatAlertMessage(transition));
    await dispatchWebhookAlert(webhookUrl, transition).catch((err: unknown) => {
      console.error(`Webhook delivery error for ${check.targetName}:`, err);
    });
  };

  const runFullSweep = async () => {
    for (const check of await probeAll(targets)) {
      await ingestCheck(check);
    }
  };

  if (once) {
    await runFullSweep();
    for (const m of store.getMetrics24h()) {
      const code = m.lastStatusCode ?? (m.isUp ? 'TCP' : 'ERR');
      console.log(
        `${m.isUp ? 'UP  ' : 'DOWN'} | ${m.targetName.padEnd(24)} | ${String(code).padEnd(4)} | last=${m.lastLatencyMs.toFixed(1)}ms | p50=${m.p50Ms?.toFixed(1) ?? '-'}ms | p95=${m.p95Ms?.toFixed(1) ?? '-'}ms | up24h=${m.uptimePct24h.toFixed(2)}%`,
      );
    }
    store.close();
    return;
  }

  const server = createDashboardServer({ store, onManualSweep: runFullSweep });
  await new Promise<void>((resolve) => server.listen(port, '127.0.0.1', resolve));
  console.log(`VPS Pulse Monitor listening on http://127.0.0.1:${port} (${targets.length} targets)`);

  await runFullSweep();

  const timers = targets.map((t) =>
    setInterval(() => void probeTarget(t).then(ingestCheck), t.intervalSeconds * 1000),
  );

  const shutdown = () => {
    for (const timer of timers) clearInterval(timer);
    server.close(() => {
      store.close();
      process.exit(0);
    });
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
