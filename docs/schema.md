# Storage schema

The tracker stores append-only events in SQLite. Each row represents a token usage update (from Codex rollouts) or a `/status` snapshot. No prompt or response content is stored.

## events table
- `captured_at` (TEXT): ISO 8601 timestamp in `Europe/Stockholm`.
- `captured_at_utc` (TEXT): ISO 8601 timestamp in UTC for stable ordering.
- `event_type` (TEXT): `token_count` (rollout-derived per-turn usage) or `status_snapshot`.
- `total_tokens` (INTEGER): tokens used in the latest turn (from `last_token_usage`).
- `input_tokens` (INTEGER): input tokens used in the latest turn.
- `cached_input_tokens` (INTEGER): cached input tokens (if reported).
- `output_tokens` (INTEGER): output tokens used in the latest turn.
- `reasoning_output_tokens` (INTEGER): reasoning tokens (if reported).
- `context_used` (INTEGER): tokens currently in context window (from `/status`).
- `context_total` (INTEGER): context window size (from `/status`).
- `context_percent_left` (REAL): percent remaining (from `/status`).
- `limit_5h_percent_left` (REAL): percent left for the 5h window (from `/status`).
- `limit_5h_resets_at` (TEXT): reset time string from `/status` (example: `18:34`).
- `limit_weekly_percent_left` (REAL): percent left for weekly limit (from `/status`).
- `limit_weekly_resets_at` (TEXT): reset time string from `/status` (example: `12:00 on 16 Jan`).
- `model` (TEXT): model name from `/status`.
- `directory` (TEXT): working directory (from `/status` or wrapper cwd).
- `session_id` (TEXT): session id from `/status`.
- `codex_version` (TEXT): Codex CLI version from `/status`.
- `source` (TEXT): capture source (rollout file path).

## Privacy
All fields are numeric usage counters or minimal metadata (model, directory, session id). No prompt/response contents or message text are stored.
