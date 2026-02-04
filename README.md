# Codex Usage Tracker

Codex Usage Tracker is a local-first tracker for OpenAI Codex CLI usage. It ingests Codex rollout JSONL files and stores token usage plus metadata in SQLite for reporting, exporting, and a local dashboard.

## Install (One Command)

Builds the bundled UI + backend and installs a `codex-track` binary on your PATH:

```bash
./scripts/install.sh
codex-track web
```

Default install locations:

* Bundle: `~/.codex-usage-tracker`
* Binary: `~/.local/bin/codex-track`

Make sure `~/.local/bin` is on your PATH.

Override with:

```bash
CODEX_USAGE_INSTALL_DIR=/path/to/install \
CODEX_USAGE_BIN_DIR=/path/to/bin \
./scripts/install.sh
```

## Overview

* **Primary goal:** Track and summarize Codex CLI token usage locally.
* **Storage:** SQLite (local).
* **Ingestion sources:** Codex rollout JSONL files (default), plus optional CLI output logs and app-server JSON-RPC logs.
* **Interfaces:** CLI (`codex-track`) and a local Next.js dashboard (`codex-track web`).

## Features

* Ingests `rollout-*.jsonl` under `~/.codex/sessions/**` and extracts usage events (TokenCount and related events).
* Stores data locally in SQLite, with **incremental ingestion** (skips unchanged files based on mtime/size).
* Generates **daily/weekly/monthly** summaries and breakdowns by **model**, **directory**, or **session**.
* Exports raw events to **JSON** or **CSV**.
* Shows the latest usage snapshot.
* Runs a local Next.js dashboard via a CLI command.

## How It Works

### Data sources (ingestion paths)

* **Rollout JSONL files (default ingestion source):**
  `~/.codex/sessions/**/rollout-*.jsonl`

* **CLI output logs (explicit ingestion):**
  `codex-track ingest-cli --log <path>`
  or from stdin: `codex-track ingest-cli --log -`

* **App-server JSON-RPC logs (explicit ingestion):**
  `codex-track ingest-app-server --log <path>`
  or from stdin: `codex-track ingest-app-server --log -`

### Auto-ingestion behavior

These commands **auto-ingest rollout files** before producing output:

* `codex-track report`
* `codex-track export`
* `codex-track status`
* `codex-track web` (or `codex-track ui`)

For `codex-track report`, time flags affect ingestion scope:

* `--last` / `--from` / `--to` limit ingestion to **files modified in that range**.
* `--today` is **local midnight → now**.

## Requirements

* Python **>= 3.10**
* Node.js (for the packaged UI runtime)
* pnpm (for building the UI during install)

## Quickstart

### 1) Report (auto-ingests rollouts)

Show today’s usage (local midnight → now):

```bash
codex-track report --today
```

Summarize the last 7 days, grouped by day, broken down by model:

```bash
codex-track report --last 7d --group day --by model
```

Output as JSON instead of a table:

```bash
codex-track report --today --format json
```

### 2) Export raw events (auto-ingests rollouts)

Export raw events as CSV:

```bash
codex-track export --format csv --out events.csv
```

### 3) Status snapshot (auto-ingests rollouts)

```bash
codex-track status
```

### 4) Launch the local dashboard (auto-ingests rollouts)

```bash
codex-track web
```

Run on a custom port and don’t open a browser:

```bash
codex-track web --port 3001 --no-open
```

### 5) Watch rollouts and auto-ingest new files

```bash
codex-track watch --interval 30
```

## CLI Reference

The bundled CLI is named: **`codex-track`**

| Command                         | Purpose                                                         | Key flags                                                                                                                                                                                               |
| ------------------------------- | --------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `codex-track report`            | Generate summaries/breakdowns (auto-ingests rollouts)           | `--db`, `--rollouts`, `--last <Nd|Nh>`, `--today`, `--from <YYYY-MM-DD or ISO>`, `--to <YYYY-MM-DD or ISO>`, `--group day|week|month`, `--by model|directory|session`, `--format table|json|csv`, `--timezone <IANA>`, `--no-content/--redact` |
| `codex-track export`            | Export raw events (auto-ingests rollouts)                       | `--db`, `--rollouts`, `--format json|csv`, `--out <path>`, `--no-content/--redact`                                                                                                                     |
| `codex-track status`            | Print latest usage snapshot (auto-ingests rollouts)             | `--db`, `--rollouts`, `--no-content/--redact`                                                                                                                                                           |
| `codex-track web`               | Launch local Next.js dashboard from `ui/`                       | `--db`, `--rollouts`, `--port`, `--no-open`                                                                                                                                                             |
| `codex-track ui`                | Alias for `codex-track web`                                     | `--db`, `--rollouts`, `--port`, `--no-open`                                                                                                                                                             |
| `codex-track watch`             | Watch rollouts and auto-ingest new files                        | `--db`, `--rollouts`, `--interval`, `--last <Nd|Nh>`, `--today`, `--from <YYYY-MM-DD or ISO>`, `--to <YYYY-MM-DD or ISO>`, `--timezone <IANA>`, `--no-content/--redact`, `--verbose`, `--strict` |
| `codex-track purge-content`     | Remove stored content messages + tool calls                     | `--db`, `--yes`                                                                                                                                                                                         |
| `codex-track ingest-cli`        | Parse Codex CLI logs for `/status` and final “Token usage” line | `--db`, `--log <path or ->`                                                                                                                                                                             |
| `codex-track ingest-app-server` | Parse app-server JSON-RPC logs and write timings/metadata       | `--db`, `--log <path or ->`                                                                                                                                                                             |
| `codex-track clear-db`          | Delete the local DB (prompts unless `--yes`)                    | `--db`, `--yes`                                                                                                                                                                                         |

## Data Stored and Privacy

### What is stored (high level)

SQLite tables include:

* `meta`, `ingestion_files`
* `events` (token usage + status snapshots + other event types; includes token counts, context window, rate/limit info, model, directory, session id, codex version, timestamps, source)
* `sessions` (session metadata like cwd, originator, cli version, git info)
* `turns` (turn metadata: model, cwd, sandbox/policy flags, truncation, reasoning flags)
* `activity_events` (counts of message/tool activity types)
* `content_messages` (full text from rollout events and response items)
* `tool_calls` (tool arguments and outputs from response items)
* `app_turns` (timings from app-server turn started/completed)
* `app_items` (timings + command/tool metadata from app-server item events)
* `weekly_quota_estimates` (derived weekly quota estimates)

### Privacy controls

If you want to avoid storing prompt/response content:

* Use `--no-content` (or `--redact`) with `report`, `export`, or `status` to skip writing `content_messages` and `tool_calls`.
* Run `codex-track purge-content` to remove already stored content from the DB.

## Configuration

### Default paths

* **Default rollouts dir:** `~/.codex/sessions`

* **Default DB path:**

  * **macOS:** `~/Library/Application Support/codex-usage-tracker/usage.sqlite`
  * **Linux:** `~/.local/share/codex-usage-tracker/usage.sqlite`

Overrides:

* Override DB path: `--db /path/to/usage.sqlite`
* Override rollouts dir: `--rollouts /path/to/sessions`

### Timezone

Reports and the UI use a configurable local timezone.

* **Default:** `Europe/Stockholm`
* **UI:** Settings → Timezone (persists to `config.json`)
* **CLI:** `codex-track report --timezone America/Los_Angeles` (one-off override)

Note: stored local timestamps reflect the timezone in effect at ingestion time. If you change the timezone and want historical data to shift, re-ingest.

### Weekly quota estimates

`codex-track report` may compute a weekly quota estimate based on the **last completed week**.

* Default weekly reset: **Thursday at 09:15 (Europe/Stockholm)**
* Override reset time via environment variable: `CODEX_USAGE_WEEKLY_RESET`

### Dashboard environment variables

When provided, `codex-track web` (or `codex-track ui`) sets:

* `CODEX_USAGE_DB`
* `CODEX_USAGE_ROLLOUTS`
* `CODEX_USAGE_CONFIG` (override config path for pricing + currency label)

## Pricing and Cost Estimation

Reports estimate cost using built-in pricing **per 1M tokens**:

| Model               | Input | Cached input | Output |
| ------------------- | ----: | -----------: | -----: |
| `gpt-5.2`           | 1.750 |        0.175 | 14.000 |
| `gpt-5.1-codex-max` |  1.25 |        0.125 |  10.00 |
| `gpt-5.1-codex`     |  1.25 |        0.125 |  10.00 |
| `gpt-5.2-codex`     |  1.75 |        0.175 |  14.00 |

### Pricing overrides

You can override per-model pricing and the currency label via a local config file.

* **Default config path:** `config.json` in the same directory as your SQLite DB.
* **Override config path:** set `CODEX_USAGE_CONFIG=/path/to/config.json`

Example:

```json
{
  "currency_label": "USD",
  "pricing": {
    "models": {
      "gpt-5.2": {
        "input_rate": 1.75,
        "cached_input_rate": 0.175,
        "output_rate": 14.0
      }
    }
  }
}
```

The dashboard Settings page lets you edit pricing overrides and the currency label without touching the config file.

## Notes

* OS support is documented for **macOS** and **Linux** default DB paths only; a Windows default path is not specified here.
