import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import Database from "better-sqlite3";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
export const projectRoot = path.resolve(__dirname, "..");
export const dataDir = path.join(projectRoot, "data");
export const incomingDir = path.join(dataDir, "incoming");
export const dbPath = path.join(dataDir, "health.sqlite");

export function openDb() {
  fs.mkdirSync(dataDir, { recursive: true });

  const db = new Database(dbPath);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  migrate(db);

  return db;
}

function migrate(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS ingestions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      file_name TEXT NOT NULL UNIQUE,
      file_path TEXT NOT NULL,
      sha256 TEXT NOT NULL,
      size_bytes INTEGER NOT NULL,
      imported_at TEXT NOT NULL,
      metrics_count INTEGER NOT NULL,
      points_count INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS metric_points (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ingestion_id INTEGER NOT NULL REFERENCES ingestions(id) ON DELETE CASCADE,
      metric_name TEXT NOT NULL,
      units TEXT,
      date_text TEXT,
      day TEXT,
      ts TEXT,
      source TEXT,
      qty REAL,
      min_value REAL,
      avg_value REAL,
      max_value REAL,
      payload_json TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_metric_points_metric_day
      ON metric_points(metric_name, day);

    CREATE INDEX IF NOT EXISTS idx_metric_points_ts
      ON metric_points(ts);

    CREATE UNIQUE INDEX IF NOT EXISTS idx_ingestions_sha256
      ON ingestions(sha256);

    CREATE TABLE IF NOT EXISTS sleep_days (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ingestion_id INTEGER NOT NULL REFERENCES ingestions(id) ON DELETE CASCADE,
      day TEXT NOT NULL,
      source TEXT,
      sleep_start TEXT,
      sleep_end TEXT,
      in_bed_start TEXT,
      in_bed_end TEXT,
      total_sleep_hr REAL,
      rem_hr REAL,
      core_hr REAL,
      deep_hr REAL,
      awake_hr REAL,
      asleep_hr REAL,
      in_bed_hr REAL,
      payload_json TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_sleep_days_day
      ON sleep_days(day);

    CREATE TABLE IF NOT EXISTS daily_summaries (
      metric_name TEXT NOT NULL,
      day TEXT NOT NULL,
      units TEXT,
      samples INTEGER NOT NULL,
      sum_value REAL,
      avg_value REAL,
      min_value REAL,
      max_value REAL,
      PRIMARY KEY (metric_name, day)
    );
  `);
}

export function rebuildDailySummaries(db) {
  db.exec(`
    DELETE FROM daily_summaries;

    INSERT INTO daily_summaries (
      metric_name,
      day,
      units,
      samples,
      sum_value,
      avg_value,
      min_value,
      max_value
    )
    SELECT
      metric_name,
      day,
      MAX(units) AS units,
      COUNT(*) AS samples,
      SUM(COALESCE(qty, avg_value)) AS sum_value,
      AVG(COALESCE(qty, avg_value)) AS avg_value,
      MIN(COALESCE(qty, avg_value, min_value)) AS min_value,
      MAX(COALESCE(qty, avg_value, max_value)) AS max_value
    FROM metric_points
    WHERE day IS NOT NULL
      AND COALESCE(qty, avg_value, min_value, max_value) IS NOT NULL
    GROUP BY metric_name, day;
  `);
}
