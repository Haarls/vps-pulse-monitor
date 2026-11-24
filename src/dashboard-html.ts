import type { IncidentRow, ServiceMetrics24h } from './store.js';

const esc = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const fmtUtc = (iso: string): string => iso.slice(0, 19).replace('T', ' ');
const fmtMs = (ms: number | null): string => (ms === null ? '—' : `${ms.toFixed(1)} ms`);

const DASHBOARD_CSS = `
  *, *::before, *::after { box-sizing: border-box; }
  body { margin: 0; background: #0B0F14; color: #F1F5F9; font: 13px/1.5 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; -webkit-font-smoothing: antialiased; }
  *:focus-visible { outline: 2px solid #4ECDC4; outline-offset: 2px; }
  .mono { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: 12px; }
  .num { font-variant-numeric: tabular-nums; }
  .muted { color: #94A3B8; }
  .r { text-align: right; }
  .st-ok { color: #10B981; } .st-warn { color: #F59E0B; } .st-err { color: #EF4444; }
  header { background: #121821; border-bottom: 1px solid #1E293B; }
  .wrap { max-width: 1120px; margin: 0 auto; padding: 0 20px; }
  .topbar { display: flex; align-items: center; justify-content: space-between; gap: 16px; padding: 14px 0; flex-wrap: wrap; }
  .brand { display: flex; align-items: center; gap: 12px; }
  .brand h1 { margin: 0; font-size: 14px; font-weight: 600; letter-spacing: -0.01em; }
  .summary-pill { border: 1px solid #1E293B; background: #0B0F14; padding: 2px 8px; border-radius: 4px; font-size: 12px; }
  .tabs { display: flex; gap: 20px; }
  .tabs a { color: #94A3B8; text-decoration: none; padding: 9px 0; font-size: 12px; font-weight: 500; border-bottom: 2px solid transparent; }
  .tabs a:hover { color: #F1F5F9; }
  .tabs a.active { color: #F1F5F9; border-bottom-color: #4ECDC4; }
  .btn { background: #4ECDC4; color: #0B0F14; border: 0; border-radius: 4px; padding: 6px 12px; font-size: 12px; font-weight: 600; cursor: pointer; }
  .btn:hover { opacity: 0.9; }
  main { padding: 24px 0 48px; }
  .panel { background: #121821; border: 1px solid #1E293B; border-radius: 4px; overflow-x: auto; margin-bottom: 24px; }
  .panel-hd { padding: 11px 16px; border-bottom: 1px solid #1E293B; display: flex; align-items: center; justify-content: space-between; }
  .panel-hd h2 { margin: 0; font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.06em; color: #94A3B8; }
  table { width: 100%; border-collapse: collapse; text-align: left; }
  th { padding: 10px 16px; font-size: 12px; font-weight: 500; color: #94A3B8; border-bottom: 1px solid #1E293B; white-space: nowrap; }
  td { padding: 10px 16px; border-bottom: 1px solid #1E293B; vertical-align: middle; }
  tbody tr:last-child td { border-bottom: 0; }
  .svc-name { font-weight: 500; color: #F1F5F9; }
  .svc-meta { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: 11px; color: #94A3B8; margin-top: 2px; }
  .badge { display: inline-block; padding: 1px 7px; border-radius: 3px; border: 1px solid #1E293B; background: #0B0F14; font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: 11px; font-weight: 600; }
  .empty, .empty-box { padding: 22px 16px; color: #94A3B8; font-size: 12px; margin: 0; }`;

export function renderDashboardHtml(services: ServiceMetrics24h[], incidents: IncidentRow[], filter: 'all' | 'down'): string {
  const downCount = services.filter((s) => !s.isUp).length;
  const visible = filter === 'down' ? services.filter((s) => !s.isUp) : services;

  const rowsHtml = visible.length === 0
    ? `<tr><td colspan="7" class="empty">${filter === 'down' ? 'No failing targets right now.' : 'No probe checks recorded yet.'}</td></tr>`
    : visible.map((s) => {
        const codeLabel = s.targetType === 'http' ? String(s.lastStatusCode ?? 'ERR') : s.isUp ? 'TCP OK' : 'TCP ERR';
        const upCls = s.uptimePct24h >= 99 ? 'st-ok' : s.uptimePct24h >= 95 ? 'st-warn' : 'st-err';
        return `<tr>
          <td><div class="svc-name">${esc(s.targetName)}</div><div class="svc-meta">${esc(s.targetType.toUpperCase())} · ${esc(s.endpoint)}</div></td>
          <td><span class="badge ${s.isUp ? 'st-ok' : 'st-err'}">${s.isUp ? 'UP' : 'DOWN'}</span></td>
          <td class="num mono">${esc(codeLabel)}</td>
          <td class="num mono r">${fmtMs(s.p50Ms)}</td>
          <td class="num mono r">${fmtMs(s.p95Ms)}</td>
          <td class="num mono r ${upCls}">${s.uptimePct24h.toFixed(2)}% <span class="muted">(${s.totalChecks24h})</span></td>
          <td class="num mono r muted">${fmtUtc(s.lastCheckedAt)}</td>
        </tr>`;
      }).join('');

  const incidentHtml = incidents.length === 0
    ? `<p class="empty-box">No failed checks in the last 24h.</p>`
    : `<table><thead><tr><th>Timestamp (UTC)</th><th>Transition</th><th>Target</th><th>Detail</th><th class="r">Outage Duration</th></tr></thead><tbody>${
        incidents.map((inc) => `<tr>
          <td class="num mono muted">${fmtUtc(inc.occurredAt)}</td>
          <td class="mono ${inc.eventType === 'DOWN' ? 'st-err' : 'st-ok'}">${inc.eventType}</td>
          <td class="mono">${esc(inc.targetName)}</td>
          <td class="muted">${esc(inc.reason)}</td>
          <td class="num mono r muted">${inc.durationSec !== null ? `${inc.durationSec}s` : '—'}</td>
        </tr>`).join('')
      }</tbody></table>`;

  return `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8" /><meta name="viewport" content="width=device-width, initial-scale=1" />
<title>VPS Pulse Monitor</title><style>${DASHBOARD_CSS}</style></head><body>
  <header><div class="wrap">
    <div class="topbar">
      <div class="brand"><h1 class="mono">VPS PULSE MONITOR</h1><span class="summary-pill num mono ${downCount > 0 ? 'st-err' : 'st-ok'}">${services.length - downCount}/${services.length} UP</span></div>
      <form method="POST" action="/probe"><button type="submit" class="btn">Run Sweep Now</button></form>
    </div>
    <nav class="tabs" aria-label="Target filter">
      <a href="/" class="num ${filter === 'all' ? 'active' : ''}">All Services (${services.length})</a>
      <a href="/?filter=down" class="num ${filter === 'down' ? 'active' : ''}">Failing (${downCount})</a>
    </nav>
  </div></header>
  <main class="wrap">
    <section class="panel" aria-labelledby="services-heading">
      <div class="panel-hd"><h2 id="services-heading">Monitored Endpoints · 24h Window</h2><span class="mono muted num">SQLite WAL · Nearest-Rank Percentiles</span></div>
      <table><thead><tr><th>Service</th><th>State</th><th>Last Code</th><th class="r">p50 (24h)</th><th class="r">p95 (24h)</th><th class="r">Uptime (24h)</th><th class="r">Last Checked (UTC)</th></tr></thead><tbody>${rowsHtml}</tbody></table>
    </section>
    <section class="panel" aria-labelledby="incidents-heading">
      <div class="panel-hd"><h2 id="incidents-heading" class="num">State-Change Incidents (${incidents.length})</h2><span class="mono muted">Deduplicated UP &lt;-&gt; DOWN transitions</span></div>
      ${incidentHtml}
    </section>
  </main>
</body></html>`;
}
