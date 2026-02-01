# Data collected (current)

This document lists everything the tracker currently stores in SQLite. Data comes from three ingestion paths:

- Rollout JSONL files: `~/.codex/sessions/**/rollout-*.jsonl`
- CLI output logs: `codex-track ingest-cli --log <path>` (or stdin)
- App-server JSON-RPC logs: `codex-track ingest-app-server --log <path>` (or stdin)

## Global metadata

### meta
Key/value metadata for the database.

- `schema_version`
- `ingest_version`

### ingestion_files
Tracks file-level ingestion state for rollouts and log files.

- `path`
- `mtime_ns`
- `size`
- `last_ingested_at`

## Rollout-derived data

### events
Per-event usage and state snapshots.

- `captured_at`
- `captured_at_utc`
- `event_type` (examples: `token_count`, `usage_line`, `status_snapshot`, `context_compacted`, `thread_rolled_back`, `undo_completed`, `turn_aborted`, `entered_review_mode`, `exited_review_mode`)
- `total_tokens`
- `input_tokens`
- `cached_input_tokens`
- `output_tokens`
- `reasoning_output_tokens`
- `lifetime_total_tokens`
- `lifetime_input_tokens`
- `lifetime_cached_input_tokens`
- `lifetime_output_tokens`
- `lifetime_reasoning_output_tokens`
- `context_used`
- `context_total`
- `context_percent_left`
- `limit_5h_percent_left`
- `limit_5h_resets_at`
- `limit_weekly_percent_left`
- `limit_weekly_resets_at`
- `limit_5h_used_percent`
- `limit_5h_window_minutes`
- `limit_5h_resets_at_seconds`
- `limit_weekly_used_percent`
- `limit_weekly_window_minutes`
- `limit_weekly_resets_at_seconds`
- `rate_limit_has_credits`
- `rate_limit_unlimited`
- `rate_limit_balance`
- `rate_limit_plan_type`
- `model`
- `directory`
- `session_id`
- `codex_version`
- `source` (rollout file path or log path)

### sessions
Session-level metadata from `session_meta` lines.

- `session_id`
- `session_timestamp`
- `session_timestamp_utc`
- `cwd`
- `originator`
- `cli_version`
- `source` (cli/vscode/exec/mcp/subagent)
- `model_provider`
- `git_commit_hash`
- `git_branch`
- `git_repository_url`
- `captured_at`
- `captured_at_utc`
- `rollout_source` (rollout file path)

### turns
Turn-level metadata from `turn_context` lines.

- `session_id`
- `turn_index`
- `captured_at`
- `captured_at_utc`
- `model`
- `cwd`
- `approval_policy`
- `sandbox_policy_type`
- `sandbox_network_access`
- `sandbox_writable_roots`
- `sandbox_exclude_tmpdir_env_var`
- `sandbox_exclude_slash_tmp`
- `truncation_policy_mode`
- `truncation_policy_limit`
- `reasoning_effort`
- `reasoning_summary`
- `has_base_instructions`
- `has_user_instructions`
- `has_developer_instructions`
- `has_final_output_json_schema`
- `source` (rollout file path)

### activity_events
Aggregated activity counters from `event_msg` and `response_item` lines.

- `captured_at`
- `captured_at_utc`
- `event_type` (examples: `user_message`, `assistant_message`, `reasoning_event`, `reasoning_raw_event`, `user_image`, `user_local_image`, `tool_call`, `tool_name`, `shell_command`)
- `event_name` (examples: `event_msg`, `response_item`, tool name, shell command name)
- `count`
- `session_id`
- `turn_index`
- `source` (rollout file path)

### content_messages
Full text content captured from rollout events and response items.

- `captured_at`
- `captured_at_utc`
- `role` (`user`, `assistant`, `reasoning`, `reasoning_raw`)
- `message_type` (`event_msg` or `response_item`)
- `message`
- `session_id`
- `turn_index`
- `source` (rollout file path)

### tool_calls
Tool arguments and outputs captured from response items.

- `captured_at`
- `captured_at_utc`
- `tool_type` (examples: `local_shell`, `function_call`, `function_call_output`, `custom_tool_call`, `custom_tool_call_output`, `web_search_call`)
- `tool_name`
- `call_id`
- `status`
- `input_text`
- `output_text`
- `command`
- `session_id`
- `turn_index`
- `source` (rollout file path)

## CLI output logs

### events (status snapshots and exit usage line)

CLI ingestion stores into the `events` table:

- `event_type = status_snapshot`
- `event_type = usage_line`

The fields used are the same as listed in `events` above, populated from `/status` or the final `Token usage:` line.

## App-server JSON-RPC logs

### app_turns
Turn timing metrics from `turn/started` and `turn/completed` notifications.

- `thread_id`
- `turn_id`
- `status`
- `started_at`
- `completed_at`
- `duration_ms`
- `source` (log path)

### app_items
Item timing and tool/command telemetry from `item/started`, `item/completed`, and command output deltas.

- `thread_id`
- `turn_id`
- `item_id`
- `item_type` (examples: `commandExecution`, `fileChange`, `mcpToolCall`, `collabAgentToolCall`, `webSearch`, etc.)
- `status`
- `started_at`
- `completed_at`
- `duration_ms`
- `command_name`
- `exit_code`
- `output_bytes`
- `tool_name`
- `web_search_action` (examples: `search`, `open_page`, `find_in_page`)
- `source` (log path)

## Derived weekly quotas

### weekly_quota_estimates
Computed by report logic when available.

- `week_start`
- `week_end`
- `quota_tokens`
- `quota_cost`
- `used_percent`
- `observed_tokens`
- `observed_cost`
- `computed_at`
