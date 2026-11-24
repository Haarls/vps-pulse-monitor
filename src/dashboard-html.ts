import { DASHBOARD_CSS } from './dashboard-css.js';
import type { IncidentRow, RecentCheckRow, ServiceMetrics24h } from './store.js';

const esc = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const fmtUtc = (iso: string): string => iso.slice(0, 19).replace('T', ' ');
const fmtMs = (ms: number | null): string => (ms === null ? '—' : `${ms.toFixed(1)} ms`);

function formatCodeLabel(s: ServiceMetrics24h): string {
  if (s.targetType === 'http') return String(s.lastStatusCode ?? 'ERR');
  return s.isUp ? 'TCP OK' : 'TCP ERR';
}

function renderSparkline(samples: Array<{ latencyMs: number; isUp: boolean }>): string {
  if (samples.length === 0) return '<span class="dim">—</span>';
  const max = Math.max(1, ...samples.map((p) => p.latencyMs));
  const bars = samples
    .map((p) => {
      const h = p.isUp ? Math.max(4, Math.round((p.latencyMs / max) * 18)) : 18;
      return `<i class="${p.isUp ? '' : 'down'}" style="height:${h}px" title="${p.isUp ? `${p.latencyMs.toFixed(1)} ms` : 'DOWN'}"></i>`;
    })
    .join('');
  return `<span class="spark" aria-hidden="true">${bars}</span>`;
}

export interface DashboardViewData {
  services: ServiceMetrics24h[];
  incidents: IncidentRow[];
  recentChecks: RecentCheckRow[];
  historyByTarget: Map<string, Array<{ latencyMs: number; isUp: boolean }>>;
  filter: 'all' | 'down';
  targetsJson: string;
  dbPath: string;
}

export function renderDashboardHtml({
  services,
  incidents,
  recentChecks,
  historyByTarget,
  filter,
  targetsJson,
  dbPath,
}: DashboardViewData): string {
  const downCount = services.filter((s) => !s.isUp).length;
  const visible = filter === 'down' ? services.filter((s) => !s.isUp) : services;
  const totalSamples = services.reduce((sum, s) => sum + s.totalChecks24h, 0);
  const upServices = services.filter((s) => s.p50Ms !== null);
  const avgP50 = upServices.length
    ? upServices.reduce((sum, s) => sum + (s.p50Ms ?? 0), 0) / upServices.length
    : 0;
  const maxP95 = upServices.length ? Math.max(...upServices.map((s) => s.p95Ms ?? 0)) : 0;

  const serviceRows =
    visible.length === 0
      ? `<tr><td colspan="8" class="empty">${filter === 'down' ? 'No failing targets right now.' : 'No probe checks recorded yet.'}</td></tr>`
      : visible
          .map((s) => {
            const upPill = s.uptimePct24h >= 99 ? 'pill-ok' : s.uptimePct24h >= 95 ? 'pill-warn' : 'pill-err';
            return `<tr>
              <td><div class="svc-name">${esc(s.targetName)}</div><div class="svc-meta">${esc(s.targetType.toUpperCase())} · ${esc(s.endpoint)}</div></td>
              <td><span class="pill ${s.isUp ? 'pill-ok' : 'pill-err'}"><span class="dot"></span>${s.isUp ? 'UP' : 'DOWN'}</span></td>
              <td class="num mono">${esc(formatCodeLabel(s))}</td>
              <td>${renderSparkline(historyByTarget.get(s.targetName) ?? [])}</td>
              <td class="num mono r">${fmtMs(s.p50Ms)}</td>
              <td class="num mono r">${fmtMs(s.p95Ms)}</td>
              <td class="num mono r"><span class="pill ${upPill}">${s.uptimePct24h.toFixed(2)}%</span></td>
              <td class="num mono r dim">${fmtUtc(s.lastCheckedAt)}</td>
            </tr>`;
          })
          .join('');

  const incidentHtml =
    incidents.length === 0
      ? '<p class="empty">No UP ↔ DOWN transitions recorded in the last 24h.</p>'
      : `<div class="table-wrap"><table><thead><tr><th>Timestamp (UTC)</th><th>Transition</th><th>Target</th><th>Detail</th><th class="r">Outage Duration</th></tr></thead><tbody>${incidents
          .map(
            (inc) => `<tr>
              <td class="num mono dim">${fmtUtc(inc.occurredAt)}</td>
              <td><span class="pill ${inc.eventType === 'DOWN' ? 'pill-err' : 'pill-ok'}">${inc.eventType}</span></td>
              <td class="mono">${esc(inc.targetName)}</td>
              <td class="muted">${esc(inc.reason)}</td>
              <td class="num mono r dim">${inc.durationSec !== null ? `${inc.durationSec}s` : '—'}</td>
            </tr>`,
          )
          .join('')}</tbody></table></div>`;

  const probeLogHtml =
    recentChecks.length === 0
      ? '<p class="empty">No live checks executed yet.</p>'
      : `<div class="table-wrap"><table><thead><tr><th>Timestamp (UTC)</th><th>Target</th><th>Endpoint</th><th>Result</th><th class="r">Latency</th></tr></thead><tbody>${recentChecks
          .map(
            (c) => `<tr>
              <td class="num mono dim">${fmtUtc(c.checkedAt)}</td>
              <td class="mono">${esc(c.targetName)}</td>
              <td class="mono dim">${esc(c.endpoint)}</td>
              <td><span class="pill ${c.isUp ? 'pill-ok' : 'pill-err'}">${c.isUp ? (c.statusCode ? `HTTP ${c.statusCode}` : 'TCP OK') : esc(c.errorMessage ?? 'ERR')}</span></td>
              <td class="num mono r">${fmtMs(c.latencyMs)}</td>
            </tr>`,
          )
          .join('')}</tbody></table></div>`;

  return `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8" /><meta name="viewport" content="width=device-width, initial-scale=1" />
<meta http-equiv="refresh" content="15" /><title>VPS Pulse Monitor</title><style>${DASHBOARD_CSS}</style></head><body>
  <header><div class="wrap">
    <div class="topbar">
      <div class="brand">
        <span class="logo">H</span>
        <h1>Haarls <span class="dim">/</span> Pulse Monitor</h1>
        <span class="pill num mono ${downCount > 0 ? 'pill-err' : 'pill-ok'}"><span class="dot"></span>${services.length - downCount}/${services.length} UP</span>
      </div>
      <div class="actions">
        <a href="/api/status" class="btn-ghost mono">/api/status</a>
        <form method="POST" action="/api/sweep"><button type="submit" class="btn-primary">Run Sweep Now</button></form>
      </div>
    </div>
    <nav class="tabs" aria-label="Target filter">
      <a href="/" class="num ${filter === 'all' ? 'active' : ''}">All Services (${services.length})</a>
      <a href="/?filter=down" class="num ${filter === 'down' ? 'active' : ''}">Failing (${downCount})</a>
    </nav>
    <div class="inspect-bar">
      <details class="about">
        <summary><span style="color:#4ECDC4">ⓘ</span> About this sandbox</summary>
        <div class="about-grid">
          <div><strong>1. Real Network Probes (Anti-SSRF)</strong>Executes live HTTP checks and TCP handshakes; custom URLs resolve DNS first to block private/loopback IPs and redirects.</div>
          <div><strong>2. SQLite WAL · 6h Rolling Retention</strong>Computes <code>p50</code>/<code>p95</code> percentiles in SQLite and auto-prunes records older than 6 hours (4,000-row hard cap).</div>
          <div><strong>3. Deduplicated Incident Alerts</strong>Records <code>DOWN</code> / <code>RECOVERED</code> transitions once per outage and dispatches webhooks only on state change.</div>
        </div>
      </details>
      <details class="about">
        <summary><span style="color:#4ECDC4">{ }</span> Inspect targets.json &amp; SQLite Engine</summary>
        <div class="cfg-box">
          <div class="cfg-meta mono">SQLite WAL DB: <span style="color:#F4F4F5">${esc(dbPath)}</span></div>
          <pre class="cfg-pre mono">${esc(targetsJson)}</pre>
        </div>
      </details>
    </div>
  </div></header>
  <main class="wrap">
    <section class="probe-bar" aria-label="Probe custom endpoint">
      <span class="mono muted" style="font-size:11px">PROBE CUSTOM ENDPOINT</span>
      <form method="POST" action="/api/probe" class="probe-form">
        <label for="custom-url" style="position:absolute;width:1px;height:1px;overflow:hidden">Custom endpoint URL</label>
        <input id="custom-url" name="url" type="url" maxlength="255" required placeholder="https://haarls.dev" class="input-url mono" />
        <button type="submit" class="btn-ghost">Test Now</button>
      </form>
    </section>
    <section class="kpis" aria-label="24h summary metrics">
      <div class="kpi"><div class="kpi-label">Healthy Targets</div><div class="kpi-val num mono">${services.length - downCount}/${services.length}</div></div>
      <div class="kpi"><div class="kpi-label">Mean p50 Latency</div><div class="kpi-val num mono">${avgP50.toFixed(1)} ms</div></div>
      <div class="kpi"><div class="kpi-label">Peak p95 Latency</div><div class="kpi-val num mono">${maxP95.toFixed(1)} ms</div></div>
      <div class="kpi"><div class="kpi-label">24h SQLite Samples</div><div class="kpi-val num mono">${totalSamples}</div></div>
    </section>
    <section class="panel" aria-labelledby="services-heading">
      <div class="panel-hd"><h2 id="services-heading">Monitored Endpoints · 24h Window</h2><span class="mono dim num">Auto-refresh 15s · Nearest-Rank Percentiles</span></div>
      <div class="table-wrap"><table><thead><tr><th>Service</th><th>State</th><th>Code</th><th>Recent Probes</th><th class="r">p50</th><th class="r">p95</th><th class="r">Uptime</th><th class="r">Checked (UTC)</th></tr></thead><tbody>${serviceRows}</tbody></table></div>
    </section>
    <section class="panel" aria-labelledby="incidents-heading">
      <div class="panel-hd"><h2 id="incidents-heading" class="num">State-Change Incidents (${incidents.length})</h2><span class="mono dim">Deduplicated UP ↔ DOWN transitions</span></div>
      ${incidentHtml}
    </section>
    <section class="panel" aria-labelledby="probes-heading">
      <div class="panel-hd"><h2 id="probes-heading">Live Probe Log (SQLite WAL)</h2><span class="mono dim num">Latest ${recentChecks.length} real measurements</span></div>
      ${probeLogHtml}
    </section>
  </main>
</body></html>`;
}
