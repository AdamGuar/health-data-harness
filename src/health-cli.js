import fs from "node:fs";
import path from "node:path";

import {
  getActivity,
  getDateRange,
  getHeartRate,
  getMetricDaily,
  getMetrics,
  getOverview,
  getSleep,
  withHealthDb
} from "./health/queries.js";
import { projectRoot } from "./db.js";

const args = process.argv.slice(2);
const command = args[0] ?? "help";
const options = parseOptions(args.slice(1));

try {
  const result = run(command, options);
  if (result !== undefined) {
    printJson(result);
  }
} catch (error) {
  console.error(JSON.stringify({ ok: false, error: error.message }, null, 2));
  process.exitCode = 1;
}

function run(name, options) {
  switch (name) {
    case "help":
      return help();
    case "metrics":
      return withHealthDb((db) => ({ ok: true, metrics: getMetrics(db) }));
    case "range":
      return withHealthDb((db) => ({ ok: true, ...getDateRange(db) }));
    case "summary":
      return withHealthDb((db) => compact({ ok: true, ...getOverview(db, options) }, options));
    case "sleep":
      return withHealthDb((db) => compact({ ok: true, ...getSleep(db, options) }, options));
    case "hr":
    case "heart":
      return withHealthDb((db) => compact({ ok: true, ...getHeartRate(db, options) }, options));
    case "activity":
      return withHealthDb((db) => compact({ ok: true, ...getActivity(db, options) }, options));
    case "metric":
      return withHealthDb((db) => ({ ok: true, ...getMetricDaily(db, options) }));
    case "save":
      return saveArtifact(options);
    default:
      throw new Error(`Unknown command "${name}". Run: npm run health:help`);
  }
}

function saveArtifact(options) {
  const title = options.title ?? "health-note";
  const kind = options.kind ?? "reports";
  const body = options.body ?? readStdin();
  const safeTitle = slug(title);
  const date = new Date().toISOString().slice(0, 10);
  const dir = path.join(projectRoot, "artifacts", "health", kind);
  const filePath = path.join(dir, `${date}-${safeTitle}.md`);

  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(filePath, body.trimEnd() + "\n", "utf8");

  return {
    ok: true,
    file: path.relative(projectRoot, filePath)
  };
}

function parseOptions(tokens) {
  const options = {};

  for (let i = 0; i < tokens.length; i += 1) {
    const token = tokens[i];
    if (!token.startsWith("--")) {
      continue;
    }

    const [rawKey, inlineValue] = token.slice(2).split("=", 2);
    const key = toCamelCase(rawKey);
    const value = inlineValue ?? tokens[i + 1];

    if (inlineValue === undefined) {
      i += 1;
    }

    options[key] = value;
  }

  return options;
}

function readStdin() {
  try {
    return fs.readFileSync(0, "utf8");
  } catch {
    return "";
  }
}

function printJson(value) {
  console.log(JSON.stringify(value, null, 2));
}

function help() {
  return {
    ok: true,
    commands: [
      "npm run health:metrics",
      "npm run health:range",
      "npm run health:summary -- --days 7",
      "npm run health:summary -- --days 7 --details true",
      "npm run health:sleep -- --days 7",
      "npm run health:hr -- --days 7",
      "npm run health:activity -- --days 7",
      "npm run health:metric -- --name heart_rate_variability --days 30",
      "npm run health:save -- --title weekly-review --body \"# Review\""
    ]
  };
}

function slug(value) {
  return String(value)
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80) || "health-note";
}

function toCamelCase(value) {
  return value.replace(/-([a-z])/g, (_match, letter) => letter.toUpperCase());
}

function compact(result, options) {
  if (String(options.details ?? "false").toLowerCase() === "true") {
    return result;
  }

  const { rows: _rows, ...rest } = result;
  return rest;
}
