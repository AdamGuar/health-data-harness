import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const projectRoot = path.resolve(import.meta.dirname, "..");
const tmpDir = path.join(projectRoot, "evals", ".tmp");
const runCodex = process.argv.includes("--codex");
const allowExternalHealthEval = process.env.ALLOW_EXTERNAL_HEALTH_EVAL === "1";
const results = [];

fs.mkdirSync(tmpDir, { recursive: true });

await test("db import audit is internally consistent", () => {
  const result = runJson("node", ["src/import-incoming.js"]);

  assert(result.ok === true, "import result should be ok");
  assert(result.checks?.ok === true, "database checks should pass");
  assert(result.checks?.integrity === "ok", "sqlite integrity_check should be ok");
  assert(result.checks?.foreignKeyViolations === 0, "foreign key check should pass");
  assert(result.checks?.duplicateHashes === 0, "ingestion hashes should be unique");
  assert(
    result.database?.metricPoints === result.database?.ingestionPointsDeclared,
    "metric_points count should match declared ingestion points"
  );
});

await test("health range exposes indexed date range", () => {
  const result = runJson("node", ["src/health-cli.js", "range"]);

  assert(result.ok === true, "range result should be ok");
  assert(Boolean(result.firstDay), "firstDay should be present");
  assert(Boolean(result.lastDay), "lastDay should be present");
  assert(result.firstDay <= result.lastDay, "firstDay should be <= lastDay");
  assert(result.ingestions.length > 0, "at least one ingestion should exist");
});

await test("compact health summary contains core sections", () => {
  const result = runJson("node", ["src/health-cli.js", "summary", "--days", "7"]);

  assert(result.ok === true, "summary result should be ok");
  assert(result.rows === undefined, "compact summary should not include rows");
  assert(result.activity?.steps?.days > 0, "steps summary should exist");
  assert(result.sleep?.days > 0, "sleep summary should exist");
  assert(result.heart?.heartRateAvg?.days > 0, "heart rate summary should exist");
});

await test("metric daily query returns targeted rows", () => {
  const result = runJson("node", [
    "src/health-cli.js",
    "metric",
    "--name",
    "heart_rate_variability",
    "--days",
    "30"
  ]);

  assert(result.ok === true, "metric result should be ok");
  assert(result.metric === "heart_rate_variability", "metric name should round-trip");
  assert(result.rows.length > 0, "metric rows should exist");
  assert(
    result.rows.every((row) => row.metricName === "heart_rate_variability"),
    "all rows should belong to requested metric"
  );
});

await test("bucketed heart rate query supports spike hunting", () => {
  const result = runJson("node", [
    "src/health-cli.js",
    "buckets",
    "--name",
    "heart_rate",
    "--days",
    "21",
    "--bucket",
    "15",
    "--sort",
    "max",
    "--limit",
    "10"
  ]);

  assert(result.ok === true, "bucket result should be ok");
  assert(result.bucketMinutes === 15, "bucket size should round-trip");
  assert(result.rows.length > 0, "bucket rows should exist");
  assert(result.rows.length <= 10, "limit should be respected");
  assert(isDescending(result.rows.map((row) => row.maxValue)), "rows should be sorted by max desc");
});

if (runCodex && allowExternalHealthEval) {
  await test("codex health chat can use CLI-backed data", () => {
    const codexBin = resolveCodexBin();
    const outputFile = path.join(tmpDir, `codex-health-${Date.now()}.md`);
    const prompt = [
      "Health eval for this repo.",
      "Read AGENTS.md and HEALTH.md.",
      "Use the local health CLI commands, not raw JSON or direct SQLite.",
      "Answer: summarize the last 7 days of sleep, activity, and heart rate.",
      "Include one sentence saying this is not medical advice.",
      "Do not modify files."
    ].join(" ");

    const result = spawnSync(
      codexBin,
      [
        "exec",
        "--ephemeral",
        "--output-last-message",
        outputFile,
        prompt
      ],
      {
        cwd: projectRoot,
        encoding: "utf8",
        shell: false,
        timeout: 180_000
      }
    );

    assert(result.status === 0, `codex exec should exit 0: ${result.stderr || result.stdout}`);
    assert(fs.existsSync(outputFile), "codex should write output-last-message file");

    const answer = fs.readFileSync(outputFile, "utf8").toLowerCase();
    assert(answer.includes("sleep") || answer.includes("sen"), "answer should mention sleep");
    assert(answer.includes("heart") || answer.includes("hr") || answer.includes("tęt"), "answer should mention heart rate");
    assert(
      answer.includes("not medical advice") || answer.includes("nie jest poradą medyczną"),
      "answer should include medical boundary"
    );
  });
} else {
  results.push({
    name: "codex health chat can use CLI-backed data",
    status: "skipped",
    reason: runCodex
      ? "set ALLOW_EXTERNAL_HEALTH_EVAL=1 to permit sending aggregated health data to Codex/OpenAI"
      : "run with: npm run evals:codex"
  });
}

printSummary();

if (results.some((result) => result.status === "failed")) {
  process.exitCode = 1;
}

async function test(name, fn) {
  const started = Date.now();
  try {
    await fn();
    results.push({ name, status: "passed", ms: Date.now() - started });
  } catch (error) {
    results.push({
      name,
      status: "failed",
      ms: Date.now() - started,
      error: error.message
    });
  }
}

function runJson(command, args) {
  const output = execFileSync(command, args, {
    cwd: projectRoot,
    encoding: "utf8",
    maxBuffer: 1024 * 1024 * 50
  });

  return JSON.parse(output);
}

function resolveCodexBin() {
  if (process.env.CODEX_BIN) {
    return process.env.CODEX_BIN;
  }

  const candidates = os.platform() === "win32" ? ["codex.cmd", "codex.exe", "codex"] : ["codex"];
  for (const candidate of candidates) {
    const result = spawnSync(candidate, ["--version"], {
      cwd: projectRoot,
      encoding: "utf8",
      shell: false,
      timeout: 10_000
    });

    if (result.status === 0) {
      return candidate;
    }
  }

  throw new Error("codex executable not found. Set CODEX_BIN or install Codex CLI.");
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function isDescending(values) {
  return values.every((value, index) => index === 0 || values[index - 1] >= value);
}

function printSummary() {
  const passed = results.filter((result) => result.status === "passed").length;
  const failed = results.filter((result) => result.status === "failed").length;
  const skipped = results.filter((result) => result.status === "skipped").length;

  console.log(JSON.stringify({ ok: failed === 0, passed, failed, skipped, results }, null, 2));
}
