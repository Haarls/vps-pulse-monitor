import Database from 'better-sqlite3';
import type { CheckRecord } from './prober.js';

export interface StateTransition {
  targetName: string;
  endpoint: string;
  eventType: 'DOWN' | 'RECOVERED';
  reason: string;
  durationSec: number | null;
  occurredAt: string;
}

export interface ServiceMetrics24h {
  targetName: string;
  targetType: 'http' | 'tcp';
  endpoint: string;
  isUp: boolean;
  lastStatusCode: number | null;
  lastLatencyMs: number;
  lastError: string | null;
  lastCheckedAt: string;
  totalChecks24h: number;
  uptimePct24h: number;
  p50Ms: number | null;
  p95Ms: number | null;
}

export interface IncidentRow {
  id: number;
  targetName: string;
  eventType: 'DOWN' | 'RECOVERED';
  reason: string;
  durationSec: number | null;
  occurredAt: string;
}

interface RawMetricRow {
  target_name: string;
  target_type: 'http' | 'tcp';
  endpoint: string;
  is_up: number;
  status_code: number | null;
  latency_ms: number;
  error_message: string | null;
  checked_at: string;
  total_24h: number;
  uptime_pct: number;
  p50_ms: number | null;
  p95_ms: number | null;
}

export class PulseStore {
  private readonly db: Database.Database;

  constructor(dbPath: string) {
    this.db = new Database(dbPath);
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('synchronous = NORMAL');
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS checks (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        target_name TEXT NOT NULL,
        target_type TEXT NOT NULL,
        endpoint TEXT NOT NULL,
        status_code INTEGER,
        latency_ms REAL NOT NULL,
        is_up INTEGER NOT NULL,
        error_message TEXT,
        checked_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_checks_target_time ON checks (target_name, checked_at DESC);

      CREATE TABLE IF NOT EXISTS target_states (
        target_name TEXT PRIMARY KEY,
        is_up INTEGER NOT NULL,
        changed_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS incidents (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        target_name TEXT NOT NULL,
        event_type TEXT NOT NULL,
        reason TEXT NOT NULL,
        duration_sec INTEGER,
        occurred_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_incidents_occurred ON incidents (occurred_at DESC);
    `);
  }

  recordCheck(check: CheckRecord): StateTransition | null {
    return this.db.transaction((): StateTransition | null => {
      this.db
        .prepare(
          `INSERT INTO checks (target_name, target_type, endpoint, status_code, latency_ms, is_up, error_message, checked_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          check.targetName,
          check.targetType,
          check.endpoint,
          check.statusCode,
          check.latencyMs,
          check.isUp ? 1 : 0,
          check.errorMessage,
          check.checkedAt,
        );

      const prior = this.db
        .prepare<[string], { is_up: number; changed_at: string }>(
          'SELECT is_up, changed_at FROM target_states WHERE target_name = ?',
        )
        .get(check.targetName);

      const upsertState = this.db.prepare(
        `INSERT INTO target_states (target_name, is_up, changed_at) VALUES (?, ?, ?)
         ON CONFLICT(target_name) DO UPDATE SET is_up = excluded.is_up, changed_at = excluded.changed_at`,
      );
      const insertIncident = this.db.prepare(
        `INSERT INTO incidents (target_name, event_type, reason, duration_sec, occurred_at)
         VALUES (?, ?, ?, ?, ?)`,
      );

      if (!prior) {
        upsertState.run(check.targetName, check.isUp ? 1 : 0, check.checkedAt);
        if (!check.isUp) {
          const reason = check.errorMessage ?? 'Target unreachable';
          insertIncident.run(check.targetName, 'DOWN', reason, null, check.checkedAt);
          return {
            targetName: check.targetName,
            endpoint: check.endpoint,
            eventType: 'DOWN',
            reason,
            durationSec: null,
            occurredAt: check.checkedAt,
          };
        }
        return null;
      }

      const wasUp = prior.is_up === 1;
      if (wasUp === check.isUp) {
        return null;
      }

      upsertState.run(check.targetName, check.isUp ? 1 : 0, check.checkedAt);

      if (!check.isUp) {
        const reason = check.errorMessage ?? 'Check failed';
        insertIncident.run(check.targetName, 'DOWN', reason, null, check.checkedAt);
        return {
          targetName: check.targetName,
          endpoint: check.endpoint,
          eventType: 'DOWN',
          reason,
          durationSec: null,
          occurredAt: check.checkedAt,
        };
      }

      const durationSec = Math.max(
        0,
        Math.round((Date.parse(check.checkedAt) - Date.parse(prior.changed_at)) / 1000),
      );
      const reason =
        check.statusCode !== null ? `HTTP ${check.statusCode} OK` : 'TCP handshake restored';
      insertIncident.run(check.targetName, 'RECOVERED', reason, durationSec, check.checkedAt);
      return {
        targetName: check.targetName,
        endpoint: check.endpoint,
        eventType: 'RECOVERED',
        reason,
        durationSec,
        occurredAt: check.checkedAt,
      };
    })();
  }

  getMetrics24h(nowIso: string = new Date().toISOString()): ServiceMetrics24h[] {
    const cutoffIso = new Date(Date.parse(nowIso) - 86_400_000).toISOString();

    // Percentiles filter on is_up = 1 so sub-millisecond ECONNREFUSED failures cannot skew latency downward.
    const rows = this.db
      .prepare<[string, string], RawMetricRow>(
        `WITH recent AS (
           SELECT * FROM checks WHERE checked_at >= ? AND checked_at <= ?
         ),
         latest AS (
           SELECT target_name, target_type, endpoint, is_up, status_code, latency_ms, error_message, checked_at,
                  ROW_NUMBER() OVER (PARTITION BY target_name ORDER BY checked_at DESC, id DESC) AS rn
           FROM checks
         ),
         agg AS (
           SELECT target_name,
                  COUNT(*) AS total_24h,
                  ROUND((SUM(is_up) * 100.0) / COUNT(*), 2) AS uptime_pct
           FROM recent
           GROUP BY target_name
         ),
         ranked_lat AS (
           SELECT target_name,
                  latency_ms,
                  ROW_NUMBER() OVER (PARTITION BY target_name ORDER BY latency_ms ASC) AS rn,
                  COUNT(*) OVER (PARTITION BY target_name) AS cnt
           FROM recent
           WHERE is_up = 1
         ),
         pct AS (
           SELECT target_name,
                  MAX(CASE WHEN rn = CAST((cnt * 50 + 99) / 100 AS INTEGER) THEN latency_ms END) AS p50_ms,
                  MAX(CASE WHEN rn = CAST((cnt * 95 + 99) / 100 AS INTEGER) THEN latency_ms END) AS p95_ms
           FROM ranked_lat
           GROUP BY target_name
         )
         SELECT l.target_name, l.target_type, l.endpoint, l.is_up, l.status_code, l.latency_ms,
                l.error_message, l.checked_at,
                COALESCE(a.total_24h, 0) AS total_24h,
                COALESCE(a.uptime_pct, 0) AS uptime_pct,
                p.p50_ms, p.p95_ms
         FROM latest l
         LEFT JOIN agg a ON a.target_name = l.target_name
         LEFT JOIN pct p ON p.target_name = l.target_name
         WHERE l.rn = 1
         ORDER BY l.target_name ASC`,
      )
      .all(cutoffIso, nowIso);

    return rows.map((r) => ({
      targetName: r.target_name,
      targetType: r.target_type,
      endpoint: r.endpoint,
      isUp: r.is_up === 1,
      lastStatusCode: r.status_code,
      lastLatencyMs: r.latency_ms,
      lastError: r.error_message,
      lastCheckedAt: r.checked_at,
      totalChecks24h: r.total_24h,
      uptimePct24h: r.uptime_pct,
      p50Ms: r.p50_ms,
      p95Ms: r.p95_ms,
    }));
  }

  getRecentIncidents(limit = 25, nowIso: string = new Date().toISOString()): IncidentRow[] {
    const cutoffIso = new Date(Date.parse(nowIso) - 86_400_000).toISOString();
    return this.db
      .prepare<[string, number], {
        id: number;
        target_name: string;
        event_type: 'DOWN' | 'RECOVERED';
        reason: string;
        duration_sec: number | null;
        occurred_at: string;
      }>(
        `SELECT id, target_name, event_type, reason, duration_sec, occurred_at
         FROM incidents
         WHERE occurred_at >= ?
         ORDER BY occurred_at DESC, id DESC
         LIMIT ?`,
      )
      .all(cutoffIso, limit)
      .map((r) => ({
        id: r.id,
        targetName: r.target_name,
        eventType: r.event_type,
        reason: r.reason,
        durationSec: r.duration_sec,
        occurredAt: r.occurred_at,
      }));
  }

  close(): void {
    this.db.close();
  }
}
