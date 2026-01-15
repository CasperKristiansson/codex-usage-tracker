# Codex Usage Tracker

Local-first tracker for OpenAI Codex CLI token usage. It wraps `codex`, parses usage lines and `/status` panels, and stores numeric counts plus minimal metadata in SQLite for reports and exports.

## What it does
- Captures `Token usage: total=...` lines from Codex CLI output.
- Captures `/status` snapshots (model, directory, session, context window, limits).
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
Wrapper mode (non-invasive):
```bash
codex-track run -- codex
```

Generate a 7-day report:
```bash
codex-track report --last 7d
```

Export raw events to CSV:
```bash
codex-track export --format csv --out usage.csv
```

Show latest quota/context snapshot:
```bash
codex-track status
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
- **Wrapper mode (current):** runs `codex` in a PTY and parses stdout lines for usage and `/status` panel data.
- **Instrumentation mode (optional):** see `docs/research.md` for suggested hooks in `codex-main` if you want structured JSON events.

## Development
Run tests:
```bash
python -m unittest discover -s tests
```
