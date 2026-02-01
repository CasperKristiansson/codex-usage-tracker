# Backend API (Next.js Route Handlers)

## Goal
Provide a local-only, aggregated API that powers the UI without loading raw tables. This is a minimal backend built into the Next.js App Router via route handlers.

## Architecture
- Next.js App Router route handlers under app/api/*
- SQLite access via better-sqlite3 (sync, fast)
- One shared DB adapter with parameterized queries
- No network calls, no auth, localhost-only

## DB Location
- Default: ~/Library/Application Support/codex-usage-tracker/usage.sqlite
- Override with env var: CODEX_USAGE_DB

## Global Query Params (accepted by all endpoints)
- from (ISO UTC)
- to (ISO UTC)
- bucket = auto|hour|day
- models = comma-separated
- dirs = comma-separated (prefix match)
- source = comma-separated
- topN = integer (default 10)

Resolved bucket rule:
- If bucket=auto: use hour for <=72h window, else day.

## Endpoints
### Meta
- GET /api/meta
  - Row counts, min/max timestamps, distinct model/dir/source counts.
  - last_ingested_at and ingested_range_utc.

Response example:
```json
{
  "row_counts": {
    "events": 151034,
    "sessions": 571,
    "turns": 75407,
    "tool_calls": 145074,
    "activity_events": 222838
  },
  "min_timestamp_utc": "2026-01-02T08:14:00Z",
  "max_timestamp_utc": "2026-02-01T10:12:31Z",
  "distinct": {
    "models": 6,
    "directories": 19,
    "sources": 1
  },
  "last_ingested_at": "2026-02-01T10:12:35Z",
  "ingested_range_utc": {
    "from": "2026-01-02T08:14:00Z",
    "to": "2026-02-01T10:12:31Z"
  }
}
```

### Sync
- GET /api/sync/status
  - Returns:
    - last_ingested_at
    - ingested_range_utc (min/max)
    - requested_range_utc (from/to resolved)
    - is_missing_data (true if requested range exceeds ingested range)

Response example:
```json
{
  "last_ingested_at": "2026-02-01T10:12:35Z",
  "ingested_range_utc": {
    "from": "2026-01-02T08:14:00Z",
    "to": "2026-02-01T10:12:31Z"
  },
  "requested_range_utc": {
    "from": "2025-11-04T00:00:00Z",
    "to": "2026-02-01T10:12:31Z"
  },
  "is_missing_data": true
}
```

- POST /api/sync/start
  - Body: optional from/to (defaults to current filter window)
  - Starts ingestion for the requested window.
  - Returns: sync_id

Response example:
```json
{
  "sync_id": "sync_20260201_101256"
}
```

- GET /api/sync/progress?sync_id=...
  - Returns progress counters:
    - files_total, files_parsed, files_skipped, errors, lines, events
  - status: running|completed|failed

Response example:
```json
{
  "sync_id": "sync_20260201_101256",
  "status": "running",
  "progress": {
    "files_total": 520,
    "files_parsed": 112,
    "files_skipped": 23,
    "lines": 182340,
    "events": 41892,
    "errors": 2
  }
}
```

### Overview
- GET /api/overview/kpis
- GET /api/overview/volume_timeseries
- GET /api/overview/token_mix_timeseries
- GET /api/overview/model_share_timeseries
- GET /api/overview/directory_top
- GET /api/overview/context_pressure
- GET /api/overview/rate_limit_headroom
- GET /api/overview/tools_composition
- GET /api/overview/friction_events

### Context and Limits
- GET /api/context/histogram
- GET /api/context/danger_rate_timeseries
- GET /api/context/compaction_timeseries
- GET /api/context/context_vs_tokens_scatter (binned aggregates only)

### Tools
- GET /api/tools/type_counts
- GET /api/tools/name_counts?tool_type=...
- GET /api/tools/error_rates
- GET /api/tools/latency_by_tool (call_id pairing)
- GET /api/tools/trend_top_tools

### Hotspots
- GET /api/hotspots/model_dir_matrix
- GET /api/hotspots/tokens_per_turn_distribution
- GET /api/hotspots/top_sessions

### Sessions and Debug
- GET /api/sessions/list?page=...&pageSize=...
- GET /api/sessions/detail?session_id=...
- GET /api/debug/tool_calls_sample
- GET /api/debug/messages_sample

## Response Rules
- Aggregated rows only (no raw tables) except debug endpoints.
- Apply time filter defaults (last 14 days) if from/to not provided.
- Always enforce Top-N + Other grouping where applicable.
- All endpoints return compact JSON; no giant payloads.

## Safety Constraints (must enforce server-side)
- Debug endpoints require strict filters and hard limits:
  - tool_calls_sample: require session_id OR time range <= 24h
  - messages_sample: require session_id + turn_index
  - hard LIMIT (<=200 rows) and truncate text (<=800 chars)
- Scatter/heatmap endpoints must return binned aggregates (never raw points).
- No endpoint should return >1,000 buckets per series.
- Sync endpoints must be idempotent for the same window (ignore duplicate starts).

## Implementation Notes
- Add a shared query builder that takes filters and produces SQL + params.
- Reuse the same WHERE clause logic across endpoints.
- Centralize bucket selection to avoid mismatched time series.
