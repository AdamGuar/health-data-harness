import { openDb } from "../db.js";

const DEFAULT_DAYS = 7;

export function withHealthDb(fn) {
  const db = openDb();
  try {
    return fn(db);
  } finally {
    db.close();
  }
}

export function getMetrics(db) {
  return db
    .prepare(
      `
      SELECT
        metric_name AS name,
        MAX(units) AS units,
        COUNT(*) AS points,
        MIN(day) AS firstDay,
        MAX(day) AS lastDay
      FROM metric_points
      GROUP BY metric_name
      ORDER BY metric_name
    `
    )
    .all();
}

export function getDateRange(db) {
  const points = db
    .prepare(
      `
      SELECT MIN(day) AS firstDay, MAX(day) AS lastDay
      FROM metric_points
      WHERE day IS NOT NULL
    `
    )
    .get();

  const ingestions = db
    .prepare(
      `
      SELECT file_name AS fileName, size_bytes AS sizeBytes, metrics_count AS metricsCount,
        points_count AS pointsCount, imported_at AS importedAt
      FROM ingestions
      ORDER BY imported_at DESC
    `
    )
    .all();

  return { ...points, ingestions };
}

export function getOverview(db, options = {}) {
  const days = normalizeDays(options.days);
  const range = getRecentDayRange(db, days);
  const metrics = getMetricDailyRows(db, CORE_METRICS, range);
  const sleep = getSleepRows(db, range);

  return {
    range,
    activity: summarizeActivity(metrics),
    sleep: summarizeSleep(sleep),
    heart: summarizeHeart(metrics),
    rows: {
      dailyMetrics: metrics,
      sleep
    }
  };
}

export function getSleep(db, options = {}) {
  const range = getRecentDayRange(db, normalizeDays(options.days));
  const rows = getSleepRows(db, range);

  return {
    range,
    summary: summarizeSleep(rows),
    rows
  };
}

export function getHeartRate(db, options = {}) {
  const range = getRecentDayRange(db, normalizeDays(options.days));
  const rows = getMetricDailyRows(
    db,
    ["heart_rate", "resting_heart_rate", "walking_heart_rate_average", "heart_rate_variability"],
    range
  );

  return {
    range,
    summary: summarizeHeart(rows),
    rows
  };
}

export function getActivity(db, options = {}) {
  const range = getRecentDayRange(db, normalizeDays(options.days));
  const rows = getMetricDailyRows(
    db,
    [
      "step_count",
      "active_energy",
      "basal_energy_burned",
      "apple_exercise_time",
      "walking_running_distance",
      "flights_climbed",
      "vo2_max"
    ],
    range
  );

  return {
    range,
    summary: summarizeActivity(rows),
    rows
  };
}

export function getMetricDaily(db, options = {}) {
  const name = options.name;
  if (!name || typeof name !== "string") {
    throw new Error("Missing required --name <metric_name>.");
  }

  const range = getRecentDayRange(db, normalizeDays(options.days));
  const rows = getMetricDailyRows(db, [name], range);

  return {
    range,
    metric: name,
    rows
  };
}

export function getMetricBuckets(db, options = {}) {
  const name = options.name;
  if (!name || typeof name !== "string") {
    throw new Error("Missing required --name <metric_name>.");
  }

  const bucketMinutes = normalizeBucketMinutes(options.bucket ?? options.resolution ?? 60);
  const range = getRecentDayRange(db, normalizeDays(options.days));
  const sort = normalizeBucketSort(options.sort);
  const limit = normalizeLimit(options.limit);
  const rows = getMetricBucketRows(db, name, range, bucketMinutes, sort, limit);

  return {
    range,
    metric: name,
    bucketMinutes,
    sort,
    limit,
    rows
  };
}

function getRecentDayRange(db, days = DEFAULT_DAYS) {
  const max = db
    .prepare("SELECT MAX(day) AS maxDay FROM metric_points WHERE day IS NOT NULL")
    .get().maxDay;

  if (!max) {
    return { days, firstDay: null, lastDay: null };
  }

  const first = db
    .prepare("SELECT date(?, ?) AS firstDay")
    .get(max, `-${days - 1} days`).firstDay;

  return { days, firstDay: first, lastDay: max };
}

function getMetricDailyRows(db, metricNames, range) {
  if (!range.firstDay || !range.lastDay) {
    return [];
  }

  const placeholders = metricNames.map(() => "?").join(", ");
  return db
    .prepare(
      `
      SELECT metric_name AS metricName, day, units, samples,
        sum_value AS sumValue, avg_value AS avgValue,
        min_value AS minValue, max_value AS maxValue
      FROM daily_summaries
      WHERE metric_name IN (${placeholders})
        AND day BETWEEN ? AND ?
      ORDER BY day, metric_name
    `
    )
    .all(...metricNames, range.firstDay, range.lastDay);
}

function getMetricBucketRows(db, metricName, range, bucketMinutes, sort, limit) {
  if (!range.firstDay || !range.lastDay) {
    return [];
  }

  const orderBy = {
    time: "bucketStart ASC",
    max: "maxValue DESC, bucketStart ASC",
    avg: "avgValue DESC, bucketStart ASC",
    samples: "samples DESC, bucketStart ASC"
  }[sort];

  const limitSql = limit === null ? "" : "LIMIT ?";
  const params = [
    metricName,
    range.firstDay,
    range.lastDay,
    bucketMinutes,
    bucketMinutes
  ];

  if (limit !== null) {
    params.push(limit);
  }

  return db
    .prepare(
      `
      WITH source_rows AS (
        SELECT
          metric_name,
          units,
          day,
          CAST(substr(date_text, 12, 2) AS INTEGER) AS hour,
          CAST(substr(date_text, 15, 2) AS INTEGER) AS minute,
          COALESCE(qty, avg_value) AS value,
          COALESCE(min_value, avg_value, qty) AS low_value,
          COALESCE(max_value, avg_value, qty) AS high_value
        FROM metric_points
        WHERE metric_name = ?
          AND day BETWEEN ? AND ?
          AND date_text IS NOT NULL
          AND COALESCE(qty, avg_value, min_value, max_value) IS NOT NULL
      ),
      bucketed AS (
        SELECT
          metric_name,
          units,
          day,
          CAST(((hour * 60 + minute) / ?) AS INTEGER) * ? AS bucket_start_minute,
          value,
          low_value,
          high_value
        FROM source_rows
      )
      SELECT
        metric_name AS metricName,
        day,
        printf(
          '%s %02d:%02d',
          day,
          CAST(bucket_start_minute / 60 AS INTEGER),
          bucket_start_minute % 60
        ) AS bucketStart,
        MAX(units) AS units,
        COUNT(*) AS samples,
        ROUND(SUM(value), 3) AS sumValue,
        ROUND(AVG(value), 3) AS avgValue,
        ROUND(MIN(low_value), 3) AS minValue,
        ROUND(MAX(high_value), 3) AS maxValue
      FROM bucketed
      GROUP BY metric_name, day, bucket_start_minute
      ORDER BY ${orderBy}
      ${limitSql}
    `
    )
    .all(...params);
}

function getSleepRows(db, range) {
  if (!range.firstDay || !range.lastDay) {
    return [];
  }

  return db
    .prepare(
      `
      SELECT day, source, sleep_start AS sleepStart, sleep_end AS sleepEnd,
        total_sleep_hr AS totalSleepHr, rem_hr AS remHr, core_hr AS coreHr,
        deep_hr AS deepHr, awake_hr AS awakeHr
      FROM sleep_days
      WHERE day BETWEEN ? AND ?
      ORDER BY day
    `
    )
    .all(range.firstDay, range.lastDay);
}

function summarizeActivity(rows) {
  return {
    steps: summarizeMetric(rows, "step_count", "sum"),
    activeEnergyKj: summarizeMetric(rows, "active_energy", "sum"),
    exerciseMinutes: summarizeMetric(rows, "apple_exercise_time", "sum"),
    distanceKm: summarizeMetric(rows, "walking_running_distance", "sum"),
    vo2Max: summarizeMetric(rows, "vo2_max", "avg")
  };
}

function summarizeHeart(rows) {
  return {
    heartRateAvg: summarizeMetric(rows, "heart_rate", "avg"),
    restingHeartRate: summarizeMetric(rows, "resting_heart_rate", "avg"),
    walkingHeartRate: summarizeMetric(rows, "walking_heart_rate_average", "avg"),
    hrvMs: summarizeMetric(rows, "heart_rate_variability", "avg")
  };
}

function summarizeSleep(rows) {
  if (rows.length === 0) {
    return emptySummary();
  }

  return {
    days: rows.length,
    totalSleepHr: average(rows.map((row) => row.totalSleepHr)),
    remHr: average(rows.map((row) => row.remHr)),
    coreHr: average(rows.map((row) => row.coreHr)),
    deepHr: average(rows.map((row) => row.deepHr)),
    awakeHr: average(rows.map((row) => row.awakeHr)),
    minTotalSleepHr: min(rows.map((row) => row.totalSleepHr)),
    maxTotalSleepHr: max(rows.map((row) => row.totalSleepHr))
  };
}

function summarizeMetric(rows, metricName, mode) {
  const metricRows = rows.filter((row) => row.metricName === metricName);
  if (metricRows.length === 0) {
    return emptySummary();
  }

  const values = metricRows.map((row) => (mode === "sum" ? row.sumValue : row.avgValue));
  return {
    days: metricRows.length,
    total: mode === "sum" ? sum(values) : undefined,
    average: average(values),
    min: min(values),
    max: max(values),
    units: metricRows.find((row) => row.units)?.units ?? null
  };
}

function normalizeDays(value) {
  const days = Number.parseInt(value ?? DEFAULT_DAYS, 10);
  if (!Number.isFinite(days) || days < 1 || days > 3660) {
    throw new Error("--days must be an integer between 1 and 3660.");
  }
  return days;
}

function normalizeBucketMinutes(value) {
  const minutes = Number.parseInt(value, 10);
  const allowed = new Set([5, 10, 15, 30, 60, 120, 240, 1440]);
  if (!allowed.has(minutes)) {
    throw new Error("--bucket must be one of: 5, 10, 15, 30, 60, 120, 240, 1440.");
  }
  return minutes;
}

function normalizeBucketSort(value) {
  const sort = value ?? "time";
  if (!["time", "max", "avg", "samples"].includes(sort)) {
    throw new Error("--sort must be one of: time, max, avg, samples.");
  }
  return sort;
}

function normalizeLimit(value) {
  if (value === undefined || value === null) {
    return null;
  }

  const limit = Number.parseInt(value, 10);
  if (!Number.isFinite(limit) || limit < 1 || limit > 10000) {
    throw new Error("--limit must be an integer between 1 and 10000.");
  }
  return limit;
}

function average(values) {
  const valid = values.filter(isNumber);
  return valid.length === 0 ? null : round(sum(valid) / valid.length);
}

function sum(values) {
  return round(values.filter(isNumber).reduce((total, value) => total + value, 0));
}

function min(values) {
  const valid = values.filter(isNumber);
  return valid.length === 0 ? null : round(Math.min(...valid));
}

function max(values) {
  const valid = values.filter(isNumber);
  return valid.length === 0 ? null : round(Math.max(...valid));
}

function round(value) {
  return Number.isFinite(value) ? Number(value.toFixed(3)) : null;
}

function isNumber(value) {
  return typeof value === "number" && Number.isFinite(value);
}

function emptySummary() {
  return {
    days: 0,
    total: null,
    average: null,
    min: null,
    max: null,
    units: null
  };
}

const CORE_METRICS = [
  "step_count",
  "active_energy",
  "basal_energy_burned",
  "apple_exercise_time",
  "walking_running_distance",
  "heart_rate",
  "resting_heart_rate",
  "walking_heart_rate_average",
  "heart_rate_variability",
  "respiratory_rate",
  "blood_oxygen_saturation",
  "apple_sleeping_wrist_temperature",
  "breathing_disturbances"
];
