# Codex Usage Tracker - Local Web Report (UI Spec)

## Purpose
A localhost-only reporting UI for a SQLite-based Codex usage tracker. The UI must quickly answer:
- Where did tokens (and implied cost) spike?
- Are we hitting context pressure or rate limits?
- Which tools/models/directories are driving usage?
- Are tools failing or slowing down?
- Which sessions are pathological?

## Non-goals
- Multi-user auth, deployment, or cloud hosting.
- Full-text exploration at scale (text is for debug drilldown only).
- Observability platform scope creep (no alerting pipelines, no long retention management).

## Target UX
- Minimalist, modern, dense but not cluttered.
- Fast: default to aggregated queries and Top-N.
- Progressive disclosure: drilldowns on click, not all details visible at once.
- Local-first: reads local SQLite DB path; no remote calls.

## Default Behavior
- Time filter defaults to last 14 days.
- Bucket auto-switch: hourly for <=72h window; daily otherwise.
- Top-N defaults: 10 (models, directories, tool names). Remainder becomes Other.
- Uses UTC for grouping internally; UI toggles display in local timezone.
- If selected time range exceeds ingested data, show a warning and offer Sync.
- Sync progress is visible in the UI while ingestion runs.

## Primary Pages
- Overview (MVP) - what changed
- Context and Limits - are we constrained
- Tools - what's used, what's broken, what's slow
- Hotspots - which model/dir combos burn tokens
- Sessions and Debug - investigate spikes safely

## Design Principles
- One primary accent color; neutral surfaces; subtle borders; no heavy gradients.
- Fewer charts, each high-signal; avoid dashboard wallpaper.
- Each chart must have:
  - Clear title
  - Short subtitle (What this answers)
  - Tight legend (inline, right-aligned)
  - Hover tooltip with exact numbers
  - Click interaction (filter or drilldown)

## Data Safety
- Never load full tables into memory by default.
- All views use SQL aggregation with time filters.
- Text-heavy tables are only accessible with hard LIMIT and additional filters.
- If data is missing for a requested range, the UI must warn and allow syncing.
