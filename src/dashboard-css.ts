export const DASHBOARD_CSS = `
  *, *::before, *::after { box-sizing: border-box; }
  html, body {
    margin: 0;
    color-scheme: dark;
    background-color: #09090B;
    background-image: radial-gradient(ellipse 80% 50% at 50% -20%, rgba(255,255,255,0.045), transparent);
    background-repeat: no-repeat;
    color: #F4F4F5;
    font: 13px/1.5 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
    -webkit-font-smoothing: antialiased;
    scrollbar-width: thin;
    scrollbar-color: rgba(255,255,255,0.14) transparent;
  }
  *:focus-visible { outline: 2px solid rgba(255,255,255,0.28); outline-offset: 2px; }
  .mono { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: 12px; }
  .num { font-variant-numeric: tabular-nums; }
  .muted { color: #A1A1AA; }
  .dim { color: #71717A; }
  .r { text-align: right; }
  .wrap { max-width: 1120px; margin: 0 auto; padding: 0 20px; }
  header { border-bottom: 1px solid rgba(255,255,255,0.08); background: rgba(9,9,11,0.88); backdrop-filter: blur(8px); }
  .topbar { display: flex; align-items: center; justify-content: space-between; gap: 14px; padding: 14px 0; flex-wrap: wrap; }
  .brand { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
  .logo { display: inline-flex; align-items: center; justify-content: center; width: 24px; height: 24px; border-radius: 6px; border: 1px solid rgba(255,255,255,0.1); background: #111113; font-weight: 700; font-size: 11px; color: #F4F4F5; }
  .brand h1 { margin: 0; font-size: 13px; font-weight: 500; letter-spacing: -0.015em; }
  .pill { display: inline-flex; align-items: center; gap: 6px; padding: 2px 8px; border-radius: 9999px; border: 1px solid rgba(255,255,255,0.08); background: #111113; font-size: 11px; font-weight: 500; }
  .pill-ok { color: #34D399; border-color: rgba(16,185,129,0.22); background: rgba(16,185,129,0.09); }
  .pill-err { color: #FB7185; border-color: rgba(244,63,94,0.24); background: rgba(244,63,94,0.1); }
  .pill-warn { color: #FBBF24; border-color: rgba(245,158,11,0.24); background: rgba(245,158,11,0.1); }
  .dot { width: 6px; height: 6px; border-radius: 9999px; background: currentColor; }
  .actions { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
  .btn-primary { background: #F4F4F5; color: #09090B; border: 0; border-radius: 8px; height: 32px; padding: 0 13px; font-size: 12px; font-weight: 500; cursor: pointer; transition: background 0.15s; }
  .btn-primary:hover { background: #FFFFFF; }
  .btn-ghost { display: inline-flex; align-items: center; gap: 6px; height: 32px; padding: 0 11px; border-radius: 8px; border: 1px solid rgba(255,255,255,0.08); background: #111113; color: #D4D4D8; font-size: 12px; font-weight: 500; text-decoration: none; cursor: pointer; }
  .btn-ghost:hover { border-color: rgba(255,255,255,0.18); color: #F4F4F5; }
  .tabs { display: flex; gap: 4px; padding-bottom: 12px; }
  .tabs a { color: #A1A1AA; text-decoration: none; padding: 5px 10px; border-radius: 7px; font-size: 12px; font-weight: 500; }
  .tabs a:hover { color: #F4F4F5; background: rgba(255,255,255,0.04); }
  .tabs a.active { color: #F4F4F5; background: rgba(255,255,255,0.08); }
  .inspect-bar { display: flex; flex-wrap: wrap; gap: 12px; border-top: 1px solid rgba(255,255,255,0.06); padding: 9px 0; }
  details.about summary { list-style: none; cursor: pointer; font-size: 12px; color: #A1A1AA; display: inline-flex; align-items: center; gap: 6px; }
  details.about summary::-webkit-details-marker { display: none; }
  details.about summary:hover { color: #F4F4F5; }
  details.about[open] { width: 100%; }
  .about-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 16px; padding: 12px 0 6px; font-size: 12px; color: #A1A1AA; }
  .about-grid strong { display: block; color: #E4E4E7; font-weight: 500; margin-bottom: 4px; }
  .cfg-box { margin-top: 10px; border: 1px solid rgba(255,255,255,0.08); border-radius: 10px; background: #0C0C0E; padding: 12px; }
  .cfg-meta { font-size: 11px; color: #A1A1AA; margin-bottom: 8px; }
  .cfg-pre { margin: 0; max-height: 220px; overflow: auto; font-size: 11px; line-height: 1.5; color: #D4D4D8; }
  .probe-bar { display: flex; align-items: center; justify-content: space-between; gap: 12px; flex-wrap: wrap; background: #111113; border: 1px solid rgba(255,255,255,0.08); border-radius: 12px; padding: 10px 14px; }
  .probe-form { display: flex; align-items: center; gap: 8px; flex: 1; min-width: 240px; }
  .input-url { flex: 1; height: 32px; border-radius: 8px; border: 1px solid rgba(255,255,255,0.09); background: #0C0C0E; padding: 0 11px; color: #F4F4F5; font-size: 12px; }
  .input-url::placeholder { color: #52525B; }
  .input-url:focus { outline: none; border-color: rgba(255,255,255,0.28); }
  main { padding: 24px 0 48px; display: flex; flex-direction: column; gap: 20px; }
  .kpis { display: grid; grid-template-columns: repeat(auto-fit, minmax(170px, 1fr)); gap: 12px; }
  .kpi { background: #111113; border: 1px solid rgba(255,255,255,0.08); border-radius: 12px; padding: 14px 16px; box-shadow: inset 0 1px 0 0 rgba(255,255,255,0.05); }
  .kpi-label { font-size: 11px; color: #71717A; text-transform: uppercase; letter-spacing: 0.05em; }
  .kpi-val { margin-top: 6px; font-size: 20px; font-weight: 600; letter-spacing: -0.02em; color: #F4F4F5; }
  .panel { background: #111113; border: 1px solid rgba(255,255,255,0.08); border-radius: 14px; overflow: hidden; box-shadow: inset 0 1px 0 0 rgba(255,255,255,0.05); }
  .panel-hd { padding: 13px 18px; border-bottom: 1px solid rgba(255,255,255,0.07); display: flex; align-items: center; justify-content: space-between; gap: 12px; flex-wrap: wrap; }
  .panel-hd h2 { margin: 0; font-size: 13px; font-weight: 500; letter-spacing: -0.01em; color: #F4F4F5; }
  .table-wrap { overflow-x: auto; }
  table { width: 100%; border-collapse: collapse; text-align: left; }
  th { padding: 10px 18px; font-size: 11px; font-weight: 500; text-transform: uppercase; letter-spacing: 0.05em; color: #71717A; border-bottom: 1px solid rgba(255,255,255,0.06); white-space: nowrap; }
  td { padding: 12px 18px; border-bottom: 1px solid rgba(255,255,255,0.05); vertical-align: middle; white-space: nowrap; }
  tbody tr:last-child td { border-bottom: 0; }
  tbody tr:hover { background: rgba(255,255,255,0.02); }
  .svc-name { font-weight: 500; color: #F4F4F5; }
  .svc-meta { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: 11px; color: #71717A; margin-top: 2px; }
  .spark { display: inline-flex; align-items: flex-end; gap: 2px; height: 18px; }
  .spark i { display: block; width: 3px; border-radius: 2px; background: #4ECDC4; opacity: 0.85; }
  .spark i.down { background: #FB7185; }
  .empty { padding: 24px 18px; color: #71717A; font-size: 12px; margin: 0; }
`;
