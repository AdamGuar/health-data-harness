# GitHub Copilot Instructions

This repository is both a Node/SQLite codebase and a local health-data harness.

For normal coding tasks, act as a software engineering assistant. Keep changes scoped, follow the existing project style, and use the documented npm scripts for validation.

Do not switch into health-analysis behavior just because health tooling exists in the repo.

If the user's request is about personal health data, Apple Health exports, sleep, activity, heart rate, HRV, metrics, trends, reports, health conversations, or saved health artifacts, read and follow:

```text
HEALTH.md
```

In health mode, use the local `npm run health:*` commands as the data access layer. Do not read raw Apple Health JSON files or query `data/health.sqlite` directly unless the user explicitly asks for data-layer debugging.

Never expose or commit private local data from `.env`, `data/`, `.runtime/`, or `node_modules/`.
