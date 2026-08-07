# Health Instructions

Use these instructions only when the task is about health-data analysis, Apple Health exports, sleep, activity, heart rate, HRV, health reports, or health conversation artifacts.

## Data Access

Use the local health CLI as the data access layer. Do not read raw Apple Health JSON files or query `data/health.sqlite` directly unless the user explicitly asks for debugging the data layer.

Preferred commands:

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

Use small, targeted commands first. Combine results in reasoning instead of requesting broad raw exports.

Add `--details true` only when daily rows are needed:

```powershell
npm run health:sleep -- --days 7 --details true
npm run health:summary -- --days 7 --details true
```

Use bucketed metric commands when the question needs time-of-day or intra-day resolution:

```powershell
npm run health:buckets -- --name heart_rate --days 21 --bucket 60
npm run health:buckets -- --name heart_rate --days 21 --bucket 15 --sort max --limit 20
```

Allowed bucket sizes are `5`, `10`, `15`, `30`, `60`, `120`, `240`, and `1440` minutes. Use `--sort max --limit N` for spike hunting, and default time ordering for trend review.

## Import Checks

When validating ingestion state, use:

```powershell
npm run db:import
```

Treat `checks.ok: true` as the deterministic import-health indicator. Compare `json.points`, `database.metricPoints`, and `database.ingestionPointsDeclared` when investigating missing or duplicated data.

## Artifact Commands

Save useful health reports, notes, and conversation summaries under `artifacts/health/`.

```powershell
npm run health:save -- --title weekly-sleep-review --body "# Weekly sleep review"
```

For longer content, pipe markdown into the command and omit `--body`.

## Medical Boundary

This project is for personal tracking and pattern analysis. Do not diagnose, prescribe, or present conclusions as medical advice. Recommend professional medical review for alarming symptoms, major changes, or urgent concerns.
