# Milestones

## Product and Data
- [x] Add a `--no-content` (or `--redact`) ingestion mode plus `codex-track purge-content` to remove `content_messages` and `tool_calls` while keeping aggregates.
- [x] Allow pricing overrides via config or UI settings, including per-model rates and a custom currency label.
- [x] Add timezone configuration for reports and UI (CLI flag + persisted setting).
- [x] Implement range comparisons (current range vs previous range with deltas).
- [x] Add session tagging/annotations to explain spikes and events.
- [x] Add per-repo and per-branch breakdowns using stored git metadata.
- [x] Add cache effectiveness insights (trends and estimated cache savings).

## Alerts and Limits
- [x] Show an ingest health panel with error samples, skipped files, last ingested range, and cost coverage.

## Ingestion and Reliability
- [x] Use hash-based ingestion tracking in addition to mtime/size to detect rewritten files.
- [x] Add a watch/daemon mode to auto-ingest new rollout files.
- [x] Remove ETA from ingest output so it shows progress only.

## UI and UX
- [x] Add drill-down navigation from any chart to sessions/turns/tool calls with filters applied.
- [x] Improve each chart expand modal so the graph uses more height and shows data rows below.
- [x] Export the current UI view (with filters) to CSV/JSON.
- [x] Add a DB insights view with record counts, DB file size, table sizes, and ingest metadata.
- [x] From the DB insights view, support exporting richer datasets (e.g., events/tool calls/turns).
- [ ] Add date presets for 90 days and 180 days.
- [ ] Fix custom range selection: only show date inputs when custom is selected, and make custom range clickable.
- [x] Update the main README with missing information and an installation guide.
