# Codex Usage Tracker

Local-first tracker for OpenAI Codex CLI token usage. It ingests Codex rollout JSONL files and stores numeric counts plus minimal metadata in SQLite for reports and exports.

## What it does
- Ingests `TokenCount` events from Codex rollout JSONL files.
- Captures model, directory, session, context window, and limit snapshots when available.
- Stores usage data locally in SQLite.
- Generates daily/weekly/monthly summaries and breakdowns by directory/model/session.
- Exports raw events to JSON or CSV.

## Privacy
This tool **does not store prompts, responses, or message text**. It only stores numeric counts and minimal metadata (model, directory, session id, version, timestamps).

## Install
From this repo:
```bash
python -m pip install -e .
```

## Quickstart
Reports and exports automatically ingest new or updated rollout files under `~/.codex/sessions`, showing a progress line while they sync. When you pass `--last` or `--from/--to`, only rollout files modified in that range are scanned.

Generate a 7-day report:
```bash
codex-track report --last 7d
```

Export raw events to CSV:
```bash
codex-track export --format csv --out usage.csv
```

Show latest usage snapshot:
```bash
codex-track status
```

Launch the web dashboard:
```bash
codex-track web --last 30d
```

The dashboard uses built-in pricing for GPT-5.2, gpt-5.1-codex-max, gpt-5.1-codex, and gpt-5.2-codex (per 1M tokens).

Clear the local DB:
```bash
codex-track clear-db
```

## Default storage location
- macOS: `~/Library/Application Support/codex-usage-tracker/usage.sqlite`
- Linux: `~/.local/share/codex-usage-tracker/usage.sqlite`

Override with `--db /path/to/usage.sqlite`.

## Reporting examples
Daily totals:
```bash
codex-track report --from 2026-01-01 --to 2026-01-07 --group day
```

Breakdown by model:
```bash
codex-track report --last 30d --group week --by model
```

Sample table output (fake data):
```
Period      Total  Input  Cached  Output  Reasoning
----------  -----  -----  ------  ------  ---------
2026-01-01  32000  25000  4000    3000    0
2026-01-02  18000  15000  1000    2000    0
```

## How it captures data
- **Rollout ingestion (current):** reads `~/.codex/sessions/**/rollout-*.jsonl` and extracts `EventMsg::TokenCount` events only.
- **Instrumentation mode (optional):** see `docs/research.md` for suggested hooks in `codex-main` if you want structured JSON events.

## Development
Run tests:
```bash
python -m unittest discover -s tests
```
