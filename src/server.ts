import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { renderDashboardHtml } from './dashboard-html.js';
import type { PulseStore } from './store.js';

const sendJson = (res: ServerResponse, status: number, payload: unknown): void => {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(payload));
};

async function readFormUrl(req: IncomingMessage): Promise<string | null> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(Buffer.from(chunk));
  const raw = new URLSearchParams(Buffer.concat(chunks).toString('utf8')).get('url')?.trim();
  if (!raw) return null;
  try {
    const u = new URL(raw);
    return u.protocol === 'http:' || u.protocol === 'https:' ? u.toString() : null;
  } catch {
    return null;
  }
}

export interface DashboardOptions {
  store: PulseStore;
  targetsJson?: string;
  dbPath?: string;
  onManualSweep?: () => Promise<void>;
  onProbeCustom?: (url: string) => Promise<void>;
}

export function createDashboardServer({
  store,
  targetsJson = '[]',
  dbPath = './pulse.db',
  onManualSweep,
  onProbeCustom,
}: DashboardOptions): Server {
  return createServer(async (req: IncomingMessage, res: ServerResponse) => {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1');

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
    if (req.method === 'POST' && url.pathname === '/probe') {
      await onManualSweep?.();
      res.writeHead(303, { Location: '/' });
      return void res.end();
    }
    if (req.method === 'POST' && url.pathname === '/probe-custom') {
      const targetUrl = await readFormUrl(req);
      if (targetUrl) await onProbeCustom?.(targetUrl);
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
