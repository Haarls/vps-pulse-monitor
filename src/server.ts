import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { renderDashboardHtml } from './dashboard-html.js';
import type { CheckRecord } from './prober.js';
import { validatePublicHttpUrl, type LookupFn } from './ssrf.js';
import type { PulseStore } from './store.js';

const RATE_WINDOW_MS = 60_000;
const MAX_ACTIONS_PER_MIN = 6;
const MAX_BODY_BYTES = 4_096;

const sendJson = (res: ServerResponse, status: number, payload: unknown): void => {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(payload));
};

function getClientIp(req: IncomingMessage): string {
  const fwd = req.headers['x-forwarded-for'];
  if (typeof fwd === 'string') {
    const first = fwd.split(',')[0]?.trim();
    if (first) return first;
  }
  const real = req.headers['x-real-ip'];
  if (typeof real === 'string' && real.trim()) return real.trim();
  return req.socket.remoteAddress ?? '127.0.0.1';
}

async function readProbeInput(req: IncomingMessage): Promise<string | null> {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of req) {
    const buf = Buffer.from(chunk);
    total += buf.length;
    if (total > MAX_BODY_BYTES) return null;
    chunks.push(buf);
  }
  const raw = Buffer.concat(chunks).toString('utf8');
  const ct = (req.headers['content-type'] ?? '').toLowerCase();
  if (ct.includes('application/json')) {
    try {
      const parsed = JSON.parse(raw) as { url?: unknown };
      return typeof parsed.url === 'string' ? parsed.url : null;
    } catch {
      return null;
    }
  }
  return new URLSearchParams(raw).get('url');
}

export interface DashboardOptions {
  store: PulseStore;
  targetsJson?: string;
  dbPath?: string;
  lookupFn?: LookupFn;
  onManualSweep?: () => Promise<void>;
  onProbeCustom?: (url: string, hostname: string) => Promise<CheckRecord>;
}

export function createDashboardServer({
  store,
  targetsJson = '[]',
  dbPath = './pulse.db',
  lookupFn,
  onManualSweep,
  onProbeCustom,
}: DashboardOptions): Server {
  const rateBuckets = new Map<string, number[]>();

  function isRateLimited(ip: string): boolean {
    const now = Date.now();
    const cutoff = now - RATE_WINDOW_MS;
    const recent = (rateBuckets.get(ip) ?? []).filter((ts) => ts > cutoff);
    if (recent.length >= MAX_ACTIONS_PER_MIN) {
      rateBuckets.set(ip, recent);
      return true;
    }
    recent.push(now);
    rateBuckets.set(ip, recent);
    return false;
  }

  return createServer(async (req: IncomingMessage, res: ServerResponse) => {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1');
    const wantsJson =
      (req.headers['content-type'] ?? '').includes('application/json') ||
      (req.headers.accept ?? '').includes('application/json');

    if (req.method === 'GET' && url.pathname === '/healthz') {
      return sendJson(res, 200, { ok: true });
    }
    if (req.method === 'GET' && url.pathname === '/api/status') {
      return sendJson(res, 200, {
        generatedAt: new Date().toISOString(),
        services: store.getMetrics24h(),
        incidents: store.getRecentIncidents(),
      });
    }
    if (req.method === 'POST' && (url.pathname === '/api/sweep' || url.pathname === '/probe')) {
      if (isRateLimited(getClientIp(req))) {
        return sendJson(res, 429, { error: '429 Too Many Requests: Max 6 sweeps/probes per minute.' });
      }
      await onManualSweep?.();
      if (wantsJson) return sendJson(res, 200, { ok: true });
      res.writeHead(303, { Location: '/' });
      return void res.end();
    }
    if (req.method === 'POST' && (url.pathname === '/api/probe' || url.pathname === '/probe-custom')) {
      if (isRateLimited(getClientIp(req))) {
        return sendJson(res, 429, { error: '429 Too Many Requests: Max 6 sweeps/probes per minute.' });
      }
      const rawUrl = await readProbeInput(req);
      const checkUrl = await validatePublicHttpUrl(rawUrl ?? '', lookupFn);
      if (!checkUrl.ok) {
        return sendJson(res, 400, { error: checkUrl.error });
      }
      const record = onProbeCustom ? await onProbeCustom(checkUrl.url, checkUrl.hostname) : null;
      if (wantsJson) return sendJson(res, 200, { check: record });
      res.writeHead(303, { Location: '/' });
      return void res.end();
    }
    if (req.method === 'GET' && url.pathname === '/') {
      const filter = url.searchParams.get('filter') === 'down' ? 'down' : 'all';
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      return void res.end(
        renderDashboardHtml({
          services: store.getMetrics24h(),
          incidents: store.getRecentIncidents(),
          recentChecks: store.getRecentChecks(12),
          historyByTarget: store.getRecentHistoryByTarget(16),
          filter,
          targetsJson,
          dbPath,
        }),
      );
    }
    sendJson(res, 404, { error: '404 Not Found' });
  });
}
