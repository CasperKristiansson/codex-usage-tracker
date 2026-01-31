# Data collection roadmap

This document lists every data point we can extract, where it comes from, and
how to capture it. The plan is grouped by milestone with actionable checkboxes.
All milestones are written to preserve the current privacy stance: never store
prompt/response text unless explicitly opted in.

## Sources of truth

1) Rollout JSONL (persisted on disk)
- Location: `~/.codex/sessions/**/rollout-*.jsonl`
- Each line is a JSON object with a `timestamp` and a `type`-tagged payload.
- Item types we can parse: `session_meta`, `turn_context`, `event_msg`,
  `response_item`, `compacted`.

2) App-server JSON-RPC stream (live)
- Transport: stdio JSON-RPC notifications from `codex app-server`.
- Best for timing data (turn duration, tool duration, command duration).

3) Optional CLI status panel output (live)
- `/status` panel includes model, directory, session, token usage, context
  window, and rate limit status.
- Current parser exists in `src/codex_usage_tracker/parser.py` but is not
  wired into ingestion.

## Milestone 0: Baseline (what we already collect)
- [ ] Document current ingestion of `EventMsg::TokenCount` from rollouts.
  Data: per-turn token usage (`total`, `input`, `cached_input`, `output`,
  `reasoning_output`), plus `context_used`, `context_total`, and computed
  `context_percent_left`. Context: `src/codex_usage_tracker/rollout.py`.
- [ ] Document metadata we already store from rollouts: `model`, `directory`,
  `session_id`, `codex_version`, `captured_at` (local + UTC), and `source`
  (rollout file path). Context: `src/codex_usage_tracker/store.py`.

## Milestone 1: Rollout metadata (safe, no content)
- [ ] Session metadata from `session_meta` lines.
  Data: `session_id`, session `timestamp`, `cwd`, `originator`,
  `cli_version`, `source` (cli/vscode/exec/mcp/subagent), `model_provider`.
  Context: `codex-main/codex-rs/protocol/src/protocol.rs` (SessionMeta).
  Collection: parse the first `session_meta` line in each rollout file and
  store fields as session-level metadata.
- [ ] Git context (if present in session metadata).
  Data: `commit_hash`, `branch`, `repository_url`.
  Context: `GitInfo` in protocol. Collection: store raw values or hash the
  repo URL if we want a privacy-preserving "repo id".
- [ ] Turn context metadata from `turn_context` lines.
  Data: `model`, `cwd`, `approval_policy`, `sandbox_policy` (type + network
  access + writable roots + exclude tmp flags), `truncation_policy`,
  reasoning `effort` and `summary` mode, and presence of instructions fields.
  Context: `TurnContextItem` in protocol.
  Collection: store fields per turn; do not store instruction text, only a
  boolean `has_*_instructions` and optional length/hash if desired.
- [ ] Enrich token usage with total lifetime counters.
  Data: `total_token_usage` (cumulative totals) and `model_context_window`.
  Context: `TokenUsageInfo` in protocol, available inside `TokenCountEvent`.
  Collection: store both last-turn and total-to-date counters so we can
  compute deltas and lifetime burn per session.
- [ ] Rate limit windows and credits.
  Data: `primary`/`secondary` windows (`used_percent`, `window_minutes`,
  `resets_at`), plus credits (`has_credits`, `unlimited`, `balance`) and
  `plan_type`.
  Context: `RateLimitSnapshot` in protocol.
  Collection: extend rollout parsing to capture all fields (not just percent
  and reset time).
- [ ] Event counts for state changes.
  Data: counts (and timestamps) of `ContextCompacted`, `ThreadRolledBack`,
  `UndoCompleted`, `TurnAborted`, `EnteredReviewMode`, `ExitedReviewMode`.
  Context: persisted `EventMsg` variants in rollout policy.
  Collection: parse `event_msg` items and store counters or event rows
  without any text payloads.

## Milestone 2: Rollout-derived activity metrics (privacy-preserving)
- [ ] Prompt count.
  Data: number of user messages per session/turn.
  Context: persisted `EventMsg::UserMessage` and `ResponseItem::Message`
  with role `user`.
  Collection: count events only; do not store message text.
- [ ] Response count.
  Data: number of assistant messages per session/turn.
  Context: persisted `EventMsg::AgentMessage` and `ResponseItem::Message`
  with role `assistant`.
  Collection: count events only; do not store message text.
- [ ] Reasoning usage.
  Data: count of reasoning events (`AgentReasoning`, `AgentReasoningRawContent`)
  and optional length metrics (chars) if needed.
  Collection: count events; if length metrics are needed, compute length and
  discard raw text.
- [ ] Image usage.
  Data: count of `images` and `local_images` from `UserMessageEvent`.
  Collection: count images; store only counts and file extensions if needed.
- [ ] Tool usage summary from response items.
  Data: counts of `LocalShellCall`, `FunctionCall`, `CustomToolCall`,
  `WebSearchCall`, `Compaction` events.
  Context: `ResponseItem` variants in protocol, persisted by rollout policy.
  Collection: count events; store tool name only (no arguments).
- [ ] Shell command surface area (privacy-preserving).
  Data: command name only (first token), or hashed full command.
  Context: `LocalShellExecAction.command` in `LocalShellCall`.
  Collection: extract command name + optional hash; do not store args/env.
- [ ] Tool name surface area.
  Data: function/custom tool names, MCP tool name (if present in output).
  Collection: store tool name + counts; avoid arguments.

## Milestone 3: Status panel snapshots (optional CLI integration)
- [ ] Capture `/status` output from CLI streams.
  Data: model, directory, session id, token usage summary, context window
  usage, 5h/weekly limit % left + reset time.
  Context: `src/codex_usage_tracker/parser.py` has a ready parser.
  Collection: wire the parser into a wrapper or log ingestion pipeline that
  can read terminal output.
- [ ] Capture final "Token usage: ..." line on exit.
  Data: total/input/cached/output/reasoning tokens per session end.
  Context: parser for token usage line exists.
  Collection: parse CLI output and store a `status_snapshot` row.

## Milestone 4: App-server instrumentation (timing + runtime)
- [ ] Turn duration.
  Data: `turn/started` and `turn/completed` timestamps, status, model.
  Context: app-server JSON-RPC notifications.
  Collection: hook a small sidecar that listens to stdout and records
  start/end timestamps by thread/turn id.
- [ ] Item and tool durations.
  Data: `item/started` and `item/completed` timestamps by item type.
  Collection: compute durations for tool calls, command execs, web search.
- [ ] Command execution telemetry (privacy-preserving).
  Data: command name, exit status, runtime, bytes output (no content).
  Context: app-server exec command events.
  Collection: store counts/durations only; do not persist stdout/stderr.
- [ ] Web search telemetry.
  Data: count of searches, open pages, find-in-page actions, and durations.
  Collection: record action type + timestamps.

## Milestone 5: Optional opt-in content capture (explicitly gated)
- [ ] Full prompt/response text.
  Data: `UserMessageEvent.message` and `AgentMessageEvent.message`, plus
  reasoning text if enabled.
  Collection: require explicit opt-in + per-project setting; store with
  encryption-at-rest or avoid entirely.
- [ ] Tool arguments and outputs.
  Data: function/custom tool arguments and output content.
  Collection: opt-in only; consider hashing or redaction rules.

## Notes on storage shape
- Keep session-level data in a `sessions` table keyed by `session_id`.
- Keep turn-level data in a `turns` table keyed by `(session_id, turn_index)`,
  with `captured_at` timestamps from rollouts or app-server.
- Keep event-level data in `events` for time-series charts and counts.
- For privacy, store only counts, booleans, and hashed identifiers by default.
