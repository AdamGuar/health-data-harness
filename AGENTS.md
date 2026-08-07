# Health Agent Instructions

Use the local health CLI as the data access layer. Do not read raw Apple Health JSON files or query `data/health.sqlite` directly unless the user explicitly asks for debugging the data layer.

## Data Commands

```powershell
npm run health:metrics
npm run health:range
npm run health:summary -- --days 7
npm run health:sleep -- --days 7
npm run health:hr -- --days 7
npm run health:activity -- --days 7
npm run health:metric -- --name heart_rate_variability --days 30
```

Use small, targeted commands first. Combine results in your reasoning instead of requesting broad raw exports.

## Artifact Commands

Save useful health reports, notes, and conversation summaries under `artifacts/health/`.

```powershell
npm run health:save -- --title weekly-sleep-review --body "# Weekly sleep review"
```

For longer content, pipe markdown into the command and omit `--body`.

## Medical Boundary

This project is for personal tracking and pattern analysis. Do not diagnose, prescribe, or present conclusions as medical advice. Recommend professional medical review for alarming symptoms, major changes, or urgent concerns.
