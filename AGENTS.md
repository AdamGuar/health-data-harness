# Agent Routing

This repository is both a small Node/SQLite codebase and a local health-data harness.

## Default Mode: Coding

For normal software engineering tasks, act as a coding agent for this repository. Follow the existing code style, keep changes scoped, and use the documented npm scripts for validation where relevant.

Do not switch into health-analysis behavior just because this repository contains health tooling.

## Health Chat Mode

If the user's message or the active task is about personal health data, Apple Health exports, sleep, activity, heart rate, HRV, metrics, trends, reports, health conversations, or saved health artifacts, read and follow:

```text
HEALTH.md
```

In health chat mode, use the local `npm run health:*` commands as the data access layer.

## Data Safety

Never commit or expose local private health data. The ignored local data paths include `.env`, `data/`, `.runtime/`, and `node_modules/`.
