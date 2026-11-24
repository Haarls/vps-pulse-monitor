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

export type IncidentRow = Omit<StateTransition, 'endpoint'> & { id: number };

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

export class PulseStore {
  private readonly db: Database.Database;

  constructor(dbPath: string) {
    this.db = new Database(dbPath);
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('synchronous = NORMAL');
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS checks (
        id INTEGER PRIMARY KEY AUTOINCREMENT, target_name TEXT NOT NULL, target_type TEXT NOT NULL,
        endpoint TEXT NOT NULL, status_code INTEGER, latency_ms REAL NOT NULL, is_up INTEGER NOT NULL,
        error_message TEXT, checked_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_checks_target_time ON checks (target_name, checked_at DESC);
      CREATE TABLE IF NOT EXISTS target_states (target_name TEXT PRIMARY KEY, is_up INTEGER NOT NULL, changed_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS incidents (
        id INTEGER PRIMARY KEY AUTOINCREMENT, target_name TEXT NOT NULL, event_type TEXT NOT NULL,
        reason TEXT NOT NULL, duration_sec INTEGER, occurred_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_incidents_occurred ON incidents (occurred_at DESC);
    `);
  }

  recordCheck(check: CheckRecord): StateTransition | null {
    return this.db.transaction((): StateTransition | null => {
      this.db
        .prepare(
          'INSERT INTO checks (target_name, target_type, endpoint, status_code, latency_ms, is_up, error_message, checked_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
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
        'INSERT INTO target_states (target_name, is_up, changed_at) VALUES (?, ?, ?) ON CONFLICT(target_name) DO UPDATE SET is_up = excluded.is_up, changed_at = excluded.changed_at',
      );

      if (!prior && check.isUp) {
        upsertState.run(check.targetName, 1, check.checkedAt);
        return null;
      }
      if (prior && (prior.is_up === 1) === check.isUp) return null;

      upsertState.run(check.targetName, check.isUp ? 1 : 0, check.checkedAt);
      const eventType = check.isUp ? 'RECOVERED' : 'DOWN';
      const durationSec =
        check.isUp && prior
          ? Math.max(
              0,
              Math.round((Date.parse(check.checkedAt) - Date.parse(prior.changed_at)) / 1000),
            )
          : null;
      let reason = check.errorMessage ?? 'Target unreachable';
      if (check.isUp) {
        reason =
          check.statusCode !== null ? `HTTP ${check.statusCode} OK` : 'TCP handshake restored';
      }

      this.db
        .prepare(
          'INSERT INTO incidents (target_name, event_type, reason, duration_sec, occurred_at) VALUES (?, ?, ?, ?, ?)',
        )
        .run(check.targetName, eventType, reason, durationSec, check.checkedAt);

      return {
        targetName: check.targetName,
        endpoint: check.endpoint,
        eventType,
        reason,
        durationSec,
        occurredAt: check.checkedAt,
      };
    })();
  }

  getMetrics24h(nowIso: string = new Date().toISOString()): ServiceMetrics24h[] {
    const cutoffIso = new Date(Date.parse(nowIso) - 86_400_000).toISOString();
    // Percentiles filter on is_up = 1 so sub-millisecond ECONNREFUSED failures cannot skew latency downward.
    return this.db
      .prepare<[string, string], Omit<ServiceMetrics24h, 'isUp'> & { isUp: number }>(
        `WITH recent AS (SELECT * FROM checks WHERE checked_at >= ? AND checked_at <= ?),
         latest AS (
           SELECT target_name, target_type, endpoint, is_up, status_code, latency_ms, error_message, checked_at,
                  ROW_NUMBER() OVER (PARTITION BY target_name ORDER BY checked_at DESC, id DESC) AS rn
           FROM checks
         ),
         agg AS (
           SELECT target_name, COUNT(*) AS total_24h, ROUND((SUM(is_up) * 100.0) / COUNT(*), 2) AS uptime_pct
           FROM recent GROUP BY target_name
         ),
         ranked_lat AS (
           SELECT target_name, latency_ms,
                  ROW_NUMBER() OVER (PARTITION BY target_name ORDER BY latency_ms ASC) AS rn,
                  COUNT(*) OVER (PARTITION BY target_name) AS cnt
           FROM recent WHERE is_up = 1
         ),
         pct AS (
           SELECT target_name,
                  MAX(CASE WHEN rn = CAST((cnt * 50 + 99) / 100 AS INTEGER) THEN latency_ms END) AS p50_ms,
                  MAX(CASE WHEN rn = CAST((cnt * 95 + 99) / 100 AS INTEGER) THEN latency_ms END) AS p95_ms
           FROM ranked_lat GROUP BY target_name
         )
         SELECT l.target_name AS targetName, l.target_type AS targetType, l.endpoint AS endpoint,
                l.is_up AS isUp, l.status_code AS lastStatusCode, l.latency_ms AS lastLatencyMs,
                l.error_message AS lastError, l.checked_at AS lastCheckedAt,
                COALESCE(a.total_24h, 0) AS totalChecks24h, COALESCE(a.uptime_pct, 0) AS uptimePct24h,
                p.p50_ms AS p50Ms, p.p95_ms AS p95Ms
         FROM latest l LEFT JOIN agg a ON a.target_name = l.target_name LEFT JOIN pct p ON p.target_name = l.target_name
         WHERE l.rn = 1 ORDER BY l.target_name ASC`,
      )
      .all(cutoffIso, nowIso)
      .map((r) => ({ ...r, isUp: r.isUp === 1 }));
  }

  getRecentIncidents(limit = 25, nowIso: string = new Date().toISOString()): IncidentRow[] {
    const cutoffIso = new Date(Date.parse(nowIso) - 86_400_000).toISOString();
    return this.db
      .prepare<[string, number], IncidentRow>(
        'SELECT id, target_name AS targetName, event_type AS eventType, reason, duration_sec AS durationSec, occurred_at AS occurredAt FROM incidents WHERE occurred_at >= ? ORDER BY occurred_at DESC, id DESC LIMIT ?',
      )
      .all(cutoffIso, limit);
  }

  close(): void {
    this.db.close();
  }
}
