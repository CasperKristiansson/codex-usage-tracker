# Data and State Contract (UI-facing)

## Global Filter State (URL-backed)
Fields (query params):
- from ISO UTC
- to ISO UTC
- bucket = auto|hour|day
- models = comma-separated
- dirs = comma-separated (prefix values allowed)
- source = comma-separated
- topN = integer (default 10)

Derived UI-only:
- resolvedBucket based on window (<=72h -> hour else day) when bucket=auto

## Backend API
- This UI uses Next.js route handlers as a local-only backend.
- Full endpoint list and server-side safety rules are defined in:
  - docs/ui/08-backend-api.md

## API Endpoints (aggregated only)
All endpoints accept the same filter params and return compact JSON.

### Meta
- GET /api/meta
Returns:
- row counts (events, sessions, turns, tool_calls, activity_events)
- min/max timestamps (utc)
- distinct counts (models, directories, sources)
- last_ingested_at (from ingestion_files)
- ingested_range_utc (min/max captured_at_utc across events)

### Sync
- GET /api/sync/status
  - indicates whether the requested time range is fully ingested
  - includes last_ingested_at and current ingestion range
- POST /api/sync/start
  - triggers ingestion for a given time window (uses from/to)
- GET /api/sync/progress
  - polling endpoint for current ingest progress (files parsed, total, errors)

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

### Context
- GET /api/context/histogram
- GET /api/context/danger_rate_timeseries
- GET /api/context/compaction_timeseries
- GET /api/context/context_vs_tokens_scatter (sampled / aggregated bins)

### Tools
- GET /api/tools/type_counts
- GET /api/tools/name_counts?tool_type=...
- GET /api/tools/error_rates
- GET /api/tools/latency_by_tool (call_id paired)
- GET /api/tools/trend_top_tools

### Hotspots
- GET /api/hotspots/model_dir_matrix (top models x top dirs with Other)
- GET /api/hotspots/tokens_per_turn_distribution (binned)
- GET /api/hotspots/top_sessions (summary list)

### Sessions and Debug
- GET /api/sessions/list (paged)
- GET /api/sessions/detail?session_id=...
- GET /api/debug/tool_calls_sample (requires session_id OR strict time range; hard LIMIT)
- GET /api/debug/messages_sample (requires session_id + turn_index; hard LIMIT)

## Caching
- Cache key = endpoint + normalized filter params.
- Client cache TTL:
  - timeseries endpoints: 30s
  - meta endpoints: 5m
  - debug sample endpoints: no cache

## Sampling Rules (mandatory)
- Scatter plots: return binned aggregates or sample max 2,000 points.
- Debug text: return max 200 rows, truncate text fields to 500-1,000 chars by default.
 - Sync progress must be polled (no streaming) and return compact counters only.

## Consistent Number Formatting
- Tokens: compact (e.g., 12.4M, 842k)
- Percent: 1 decimal for charts, 0 decimals for KPI pills
- Duration: ms -> 1.2s, 840ms
