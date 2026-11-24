import { Socket } from 'node:net';
import { performance } from 'node:perf_hooks';
import { formatEndpoint, type TargetConfig } from './config.js';

export interface CheckRecord {
  targetName: string;
  targetType: 'http' | 'tcp';
  endpoint: string;
  statusCode: number | null;
  latencyMs: number;
  isUp: boolean;
  errorMessage: string | null;
  checkedAt: string;
}

const roundMs = (ms: number): number => Math.round(ms * 10) / 10;

async function probeHttp(target: Extract<TargetConfig, { type: 'http' }>): Promise<CheckRecord> {
  const started = performance.now();
  const checkedAt = new Date().toISOString();

  try {
    const res = await fetch(target.url, {
      redirect: 'follow',
      headers: { 'User-Agent': 'vps-pulse-monitor/1.0' },
      signal: AbortSignal.timeout(target.timeoutMs),
    });
    const latencyMs = roundMs(performance.now() - started);
    await res.body?.cancel().catch(() => undefined);

    const isUp = res.status === target.expectedStatus;
    return {
      targetName: target.name,
      targetType: 'http',
      endpoint: target.url,
      statusCode: res.status,
      latencyMs,
      isUp,
      errorMessage: isUp ? null : `Expected HTTP ${target.expectedStatus}, got ${res.status}`,
      checkedAt,
    };
  } catch (err) {
    return {
      targetName: target.name,
      targetType: 'http',
      endpoint: target.url,
      statusCode: null,
      latencyMs: roundMs(performance.now() - started),
      isUp: false,
      errorMessage: err instanceof Error ? err.message : String(err),
      checkedAt,
    };
  }
}

function probeTcp(target: Extract<TargetConfig, { type: 'tcp' }>): Promise<CheckRecord> {
  const started = performance.now();
  const checkedAt = new Date().toISOString();
  const endpoint = formatEndpoint(target);

  return new Promise((resolve) => {
    const socket = new Socket();
    let settled = false;

    const finish = (isUp: boolean, errorMessage: string | null) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve({
        targetName: target.name,
        targetType: 'tcp',
        endpoint,
        statusCode: null,
        latencyMs: roundMs(performance.now() - started),
        isUp,
        errorMessage,
        checkedAt,
      });
    };

    socket.setTimeout(target.timeoutMs);
    socket.once('connect', () => finish(true, null));
    socket.once('timeout', () => finish(false, `TCP timeout after ${target.timeoutMs}ms`));
    socket.once('error', (err) => finish(false, err.message));
    socket.connect(target.port, target.host);
  });
}

export function probeTarget(target: TargetConfig): Promise<CheckRecord> {
  return target.type === 'http' ? probeHttp(target) : probeTcp(target);
}

export async function probeAll(targets: TargetConfig[], concurrency = 8): Promise<CheckRecord[]> {
  const results = new Array<CheckRecord>(targets.length);
  let cursor = 0;

  await Promise.all(
    Array.from({ length: Math.min(concurrency, targets.length) }, async () => {
      while (cursor < targets.length) {
        const idx = cursor++;
        const target = targets[idx];
        if (target) results[idx] = await probeTarget(target);
      }
    }),
  );
  return results;
}
