# Codex CLI usage and status research

## Token usage line
- `codex-main/codex-rs/cli/src/main.rs` prints the final usage line on exit in `format_exit_messages`.
  - Calls `codex_core::protocol::FinalOutput::from(token_usage)`.
- `codex-main/codex-rs/protocol/src/protocol.rs` implements `impl fmt::Display for FinalOutput`.
  - Formatting: `Token usage: total={total} input={input} (+ {cached} cached) output={output} (reasoning {reasoning})`.
  - Cached and reasoning sections are conditional.
- `TokenUsage` and `TokenUsageInfo` live in `codex-main/codex-rs/protocol/src/protocol.rs`.
  - `TokenUsage` fields: `input_tokens`, `cached_input_tokens`, `output_tokens`, `reasoning_output_tokens`, `total_tokens`.
  - `TokenUsageInfo` includes `total_token_usage`, `last_token_usage`, and `model_context_window`.

## /status panel
- `/status` output is built in `codex-main/codex-rs/tui/src/status/card.rs`.
  - `new_status_output` builds a `StatusHistoryCell` for `/status`.
  - `display_lines` renders the box, including:
    - `OpenAI Codex (vX)` header and version from `CODEX_CLI_VERSION`.
    - `Model`, `Directory`, `Session` lines.
    - `Token usage` line using compact token formatting.
    - `Context window` line when available.
    - Rate limit lines composed via `status/rate_limits.rs`.
- `codex-main/codex-rs/tui/src/status/rate_limits.rs` renders rate limit rows.
  - Progress bar via `render_status_limit_progress_bar` and `% left` via `format_status_limit_summary`.
  - Reset timestamps formatted by `format_reset_timestamp` in `status/helpers.rs`.
  - Reset text is either `HH:MM` or `HH:MM on 16 Jan` based on same-day vs future date.

## Potential instrumentation hooks
- `codex-main/codex-rs/app-server/README.md` notes JSON-RPC notifications:
  - Usage events via `thread/tokenUsage/updated`.
  - Turn lifecycle: `turn/started` and `turn/completed`.
- A low-friction instrumentation option is emitting structured JSON lines when `FinalOutput` is printed in `handle_app_exit`, or when `TokenUsageInfo` is updated for in-session events.
