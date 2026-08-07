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
