# Health Data Harness

Local harness for ingesting and analyzing Apple Health export data with agents.

The project receives Apple Health data over HTTP, keeps the raw export files, indexes supported JSON exports into SQLite, and exposes a small CLI query layer that an agent can use safely during chat. For now, the agent harness is **Codex**: Codex talks to this repo by running the documented `npm run health:*` commands and can save reports or conversation artifacts into `artifacts/health/`.

This is not a medical device and does not provide medical advice. It is a personal data analysis harness for trends, summaries, and exploratory questions.

## How It Works

```text
Apple Health export app
  -> ngrok public URL
  -> local Node ingest server
  -> raw JSON files in data/incoming/
  -> SQLite database in data/health.sqlite
  -> health CLI commands
  -> Codex chat / reports / artifacts
```

The important design choice is that agents should not consume the full raw Apple Health export directly. They should call small, deterministic CLI commands that return compact JSON summaries or targeted daily rows.

## Components

```text
src/server.js
```

Runs the local HTTP ingest server. It accepts authenticated uploads at `POST /ingest`, writes received files to `data/incoming/`, and imports JSON uploads into SQLite.

```text
src/importer.js
```

Parses Apple Health JSON exports from `data/incoming/` and inserts normalized rows into SQLite.

```text
src/db.js
```

Creates and migrates the local SQLite schema.

```text
src/health/queries.js
```

Contains the allowed read queries used by the CLI. This is the query layer agents should rely on.

```text
src/health-cli.js
```

Command-line interface for health data summaries, metric lookups, and artifact writing.

```text
AGENTS.md
```

Routing instructions for Codex and other coding agents. It keeps normal coding sessions separate from health chat sessions.

```text
HEALTH.md
```

Health-specific instructions. Agents should read this file when the conversation is about health data, Apple Health exports, metrics, trends, reports, or health artifacts.

```text
.github/copilot-instructions.md
```

GitHub Copilot routing instructions for this repository.

```text
CLAUDE.md
```

Claude routing instructions for this repository.

## Setup

```powershell
npm install
```

Create or update `.env`:

```text
PORT=8080
HEALTH_AUTH_HEADER=x-health-auth
HEALTH_INGEST_KEY=replace-with-a-long-random-secret
MAX_UPLOAD_MB=100
```

Your current local `.env` contains the active key for your ingest client. Keep it private.

## Running Ingest

Start the local server:

```powershell
npm start
```

`npm start` first imports existing files from `data/incoming/`, then starts the server on:

```text
http://localhost:8080
```

Endpoints:

```text
GET  /health
POST /ingest
```

`POST /ingest` supports multipart uploads and raw request bodies. JSON uploads are indexed into SQLite automatically.

## Expose With ngrok

In one terminal:

```powershell
npm start
```

In another terminal:

```powershell
npm run ngrok
```

The configured ngrok script tunnels local port `8080`:

```text
https://impatient-ounce-unstaffed.ngrok-free.dev
```

Send Apple Health exports to:

```text
https://impatient-ounce-unstaffed.ngrok-free.dev/ingest
```

Required ingest auth header:

```text
x-health-auth: <HEALTH_INGEST_KEY>
```

For free ngrok tunnels, API clients may also need:

```text
ngrok-skip-browser-warning: true
```

## SQLite Storage

The database lives at:

```text
data/health.sqlite
```

Main tables:

```text
ingestions
metric_points
sleep_days
daily_summaries
```

Idempotency is based on SHA-256 content hash. Renaming a previously imported JSON file will not duplicate its data in SQLite.

Manual reimport:

```powershell
npm run db:import
```

The import command prints a deterministic audit summary after every run:

```text
json.files                 JSON files found in data/incoming/
json.points                total metric rows counted in those JSON files
importedThisRun.points     metric rows inserted during this run
database.metricPoints      current metric rows in SQLite
database.ingestionPointsDeclared
checks.ok                  aggregate integrity result
```

For a healthy import, `checks.ok` should be `true`, and `database.metricPoints` should match `database.ingestionPointsDeclared`. If all files are already indexed, `importedThisRun.points` will be `0` and the database totals should remain unchanged.

## Health CLI

These commands are the stable interface for Codex and ad hoc analysis:

```powershell
npm run health:metrics
npm run health:range
npm run health:summary -- --days 7
npm run health:sleep -- --days 7
npm run health:hr -- --days 7
npm run health:activity -- --days 7
npm run health:metric -- --name heart_rate_variability --days 30
npm run health:buckets -- --name heart_rate --days 21 --bucket 60
```

Default output is compact JSON for chat context. Add `--details true` when an agent needs daily rows:

```powershell
npm run health:sleep -- --days 7 --details true
npm run health:summary -- --days 7 --details true
```

Use bucketed metric output for hourly or finer time-of-day analysis:

```powershell
npm run health:buckets -- --name heart_rate --days 21 --bucket 60
npm run health:buckets -- --name heart_rate --days 21 --bucket 15 --sort max --limit 20
```

Allowed bucket sizes are `5`, `10`, `15`, `30`, `60`, `120`, `240`, and `1440` minutes.

## Agent Harness

The current primary agent harness is **Codex**. Routing instruction files are also provided for GitHub Copilot and Claude.

Codex should:

- read `AGENTS.md` for routing
- read `HEALTH.md` when the chat context is about health data
- use `npm run health:*` commands for health data
- avoid raw `data/incoming/*.json` and direct SQLite queries unless debugging the data layer
- save durable outputs into `artifacts/health/`

Typical Codex workflow:

```text
User asks a health question
  -> Codex runs one or more health CLI commands
  -> Codex interprets the compact JSON
  -> Codex answers in chat
  -> Codex optionally saves a markdown artifact
```

This keeps the chat flexible while keeping data access constrained and repeatable.

## Evals

Run deterministic local evals:

```powershell
npm run evals
```

The default eval suite checks import consistency, core health CLI commands, and bucketed heart-rate queries. It does not call a model.

Run optional Codex-backed evals:

```powershell
npm run evals:codex
```

The Codex eval uses `codex exec --ephemeral` and asks Codex to answer a health question through the local CLI layer. Because this can send aggregated health summaries to Codex/OpenAI, it is skipped unless you explicitly opt in:

```powershell
$env:ALLOW_EXTERNAL_HEALTH_EVAL = "1"
npm run evals:codex
```

On Windows, if PowerShell blocks `codex.ps1`, the eval runner tries `codex.cmd`; you can also set `CODEX_BIN` to an explicit executable path.

## Artifacts

Reports and conversation notes live under:

```text
artifacts/health/reports/
artifacts/health/conversations/
```

Save a short markdown artifact:

```powershell
npm run health:save -- --title weekly-review --body "# Weekly review"
```

For longer content, pipe markdown into the command and omit `--body`.

## Privacy Notes

The raw exports and SQLite database contain private health data. They are ignored by Git:

```text
data/incoming/
data/*.sqlite
data/*.sqlite-*
```

Do not commit `.env`, raw exports, or the SQLite database.

## Pre-Commit Guard

Husky runs a pre-commit check that rejects staged private or generated local paths:

```text
.env
.env.*
data/
.runtime/
node_modules/
.ngrok*
ngrok.yml
ngrok.yaml
artifacts/health/reports/*
artifacts/health/conversations/*
```

The `.gitkeep` files inside `artifacts/health/reports/` and `artifacts/health/conversations/` are allowed so the directory structure can stay in Git.

Run the check manually:

```powershell
npm run precommit:check
```
