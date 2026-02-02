# Upgrade Features (Implement in order)

## M0 - Performance + Hygiene
- [ ] Add `captured_at_utc` + composite indexes for events/tool_calls/content_messages/turns/activity_events.
- [ ] Add UI cache pruning to prevent unbounded growth.
- [ ] Clean up stale sync progress files on startup.

Acceptance:
- Dashboard queries remain fast on large datasets.
- Sync temp files do not grow without bound.

## M1 - Data Source + Filter Options
- [ ] Support per-request DB override (`db=`) in API handlers.
- [ ] Add `/api/settings/db_info` for DB path validation and stats.
- [ ] Add `/api/filters/options` for model/dir/source suggestions.

Acceptance:
- Switching DB path updates data without restarting the app.
- Filters bar shows typeahead suggestions for models/dirs/sources.

## M2 - Top-N + Other Consistency
- [ ] Add `Other` buckets to tools composition, tool names, and tool trends endpoints.
- [ ] Update tool charts and bar lists to render `Other` last.

Acceptance:
- Every Top-N chart includes a clear `Other` bucket when applicable.

## M3 - Cost + Quota Analytics
- [ ] Centralize default pricing config (shared by UI + API).
- [ ] Add cost KPIs and cost timeseries endpoints.
- [ ] Add weekly quota endpoint + UI summary panel.

Acceptance:
- Overview shows estimated cost and weekly quota usage when enabled.

## M4 - Latency Accuracy
- [ ] Prefer app-server timing data (app_items) when available.
- [ ] Fall back to tool_calls call_id pairing when app_items is missing.

Acceptance:
- Latency metrics match app-server timings for command/tool calls.

## M5 - Settings Parity
- [ ] Data source controls with apply/test/reset.
- [ ] Cost model toggle + pricing table.
- [ ] Appearance controls for theme + density.

Acceptance:
- Settings page matches UI spec and changes persist across refresh.

## M6 - UI Drilldown Enhancements
- [ ] Series toggles in expanded chart views.
- [ ] Copy filter query params from expand modal.
- [ ] Multi-select typeahead filters in header.

Acceptance:
- Expanded views allow hiding series and copying filters.
- Filters are faster to use with suggestions + chip selection.

## M7 - CLI + Docs Cleanup
- [ ] Add `codex-track ui` command for the Next.js dashboard.
- [ ] Remove Streamlit dashboard code.
- [ ] Update README.md to reference the new UI command.

Acceptance:
- CLI launches the Next.js UI and Streamlit is fully removed.
