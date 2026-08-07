import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import { incomingDir, openDb, rebuildDailySummaries } from "./db.js";

export function importIncomingDirectory() {
  fs.mkdirSync(incomingDir, { recursive: true });

  const db = openDb();
  try {
    const files = fs
      .readdirSync(incomingDir)
      .filter((file) => file.toLowerCase().endsWith(".json"))
      .sort();

    const results = files.map((file) => importHealthFile(db, path.join(incomingDir, file)));
    rebuildDailySummaries(db);

    return {
      dbPath: db.name,
      files: results,
      importedFiles: results.filter((result) => result.imported).length,
      skippedFiles: results.filter((result) => result.skipped).length,
      points: results.reduce((sum, result) => sum + (result.pointsCount ?? 0), 0)
    };
  } finally {
    db.close();
  }
}

export function importSavedJsonFile(filePath) {
  const db = openDb();
  try {
    const result = importHealthFile(db, filePath);
    rebuildDailySummaries(db);
    return {
      dbPath: db.name,
      ...result
    };
  } finally {
    db.close();
  }
}

function importHealthFile(db, filePath) {
  const absolutePath = path.resolve(filePath);
  const fileName = path.basename(absolutePath);
  const raw = fs.readFileSync(absolutePath);
  const sha256 = crypto.createHash("sha256").update(raw).digest("hex");
  const existingByHash = db
    .prepare("SELECT id, file_name FROM ingestions WHERE sha256 = ?")
    .get(sha256);

  if (existingByHash) {
    return {
      fileName,
      skipped: true,
      reason: "already_imported_same_content",
      existingFileName: existingByHash.file_name
    };
  }

  const existingByName = db
    .prepare("SELECT id, sha256 FROM ingestions WHERE file_name = ?")
    .get(fileName);

  const payload = JSON.parse(raw.toString("utf8"));
  const metrics = payload?.data?.metrics;
  if (!Array.isArray(metrics)) {
    return {
      fileName,
      skipped: true,
      reason: "missing_data_metrics"
    };
  }

  const importTx = db.transaction(() => {
    if (existingByName) {
      db.prepare("DELETE FROM ingestions WHERE id = ?").run(existingByName.id);
    }

    const pointsCount = metrics.reduce(
      (sum, metric) => sum + (Array.isArray(metric.data) ? metric.data.length : 0),
      0
    );

    const ingestion = db
      .prepare(`
        INSERT INTO ingestions (
          file_name,
          file_path,
          sha256,
          size_bytes,
          imported_at,
          metrics_count,
          points_count
        )
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `)
      .run(
        fileName,
        absolutePath,
        sha256,
        raw.length,
        new Date().toISOString(),
        metrics.length,
        pointsCount
      );

    insertMetrics(db, ingestion.lastInsertRowid, metrics);

    return {
      fileName,
      imported: true,
      metricsCount: metrics.length,
      pointsCount
    };
  });

  return importTx();
}

function insertMetrics(db, ingestionId, metrics) {
  const insertPoint = db.prepare(`
    INSERT INTO metric_points (
      ingestion_id,
      metric_name,
      units,
      date_text,
      day,
      ts,
      source,
      qty,
      min_value,
      avg_value,
      max_value,
      payload_json
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const insertSleep = db.prepare(`
    INSERT INTO sleep_days (
      ingestion_id,
      day,
      source,
      sleep_start,
      sleep_end,
      in_bed_start,
      in_bed_end,
      total_sleep_hr,
      rem_hr,
      core_hr,
      deep_hr,
      awake_hr,
      asleep_hr,
      in_bed_hr,
      payload_json
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  for (const metric of metrics) {
    const metricName = metric.name;
    const units = metric.units ?? null;
    const rows = Array.isArray(metric.data) ? metric.data : [];

    for (const row of rows) {
      const dateText = row.date ?? row.startDate ?? row.sleepStart ?? null;
      const parsed = parseAppleDate(dateText);
      const payloadJson = JSON.stringify(row);

      insertPoint.run(
        ingestionId,
        metricName,
        units,
        dateText,
        parsed.day,
        parsed.iso,
        row.source ?? null,
        numberOrNull(row.qty),
        numberOrNull(row.Min),
        numberOrNull(row.Avg),
        numberOrNull(row.Max),
        payloadJson
      );

      if (metricName === "sleep_analysis") {
        insertSleep.run(
          ingestionId,
          parsed.day,
          row.source ?? null,
          parseAppleDate(row.sleepStart).iso,
          parseAppleDate(row.sleepEnd).iso,
          parseAppleDate(row.inBedStart).iso,
          parseAppleDate(row.inBedEnd).iso,
          numberOrNull(row.totalSleep),
          numberOrNull(row.rem),
          numberOrNull(row.core),
          numberOrNull(row.deep),
          numberOrNull(row.awake),
          numberOrNull(row.asleep),
          numberOrNull(row.inBed),
          payloadJson
        );
      }
    }
  }
}

function parseAppleDate(value) {
  if (!value || typeof value !== "string") {
    return { iso: null, day: null };
  }

  const match = value.match(
    /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2}) ([+-]\d{2})(\d{2})$/
  );

  if (!match) {
    const fallback = new Date(value);
    return Number.isNaN(fallback.valueOf())
      ? { iso: null, day: value.slice(0, 10) || null }
      : { iso: fallback.toISOString(), day: fallback.toISOString().slice(0, 10) };
  }

  const [, year, month, day, hour, minute, second, offsetHour, offsetMinute] = match;
  const isoLike = `${year}-${month}-${day}T${hour}:${minute}:${second}${offsetHour}:${offsetMinute}`;
  const parsed = new Date(isoLike);

  return {
    iso: Number.isNaN(parsed.valueOf()) ? null : parsed.toISOString(),
    day: `${year}-${month}-${day}`
  };
}

function numberOrNull(value) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}
