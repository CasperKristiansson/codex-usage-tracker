import json
from dataclasses import dataclass, field
from datetime import datetime
from pathlib import Path
from typing import Dict, Iterable, Iterator, List, Optional, Tuple
from zoneinfo import ZoneInfo

from .config import DEFAULT_TIMEZONE

BASELINE_TOKENS = 12000
DEFAULT_TZ = ZoneInfo(DEFAULT_TIMEZONE)


@dataclass
class RolloutContext:
    session_id: Optional[str] = None
    directory: Optional[str] = None
    codex_version: Optional[str] = None
    model: Optional[str] = None


@dataclass
class ParsedSessionMeta:
    captured_at_local: datetime
    captured_at_utc: datetime
    session_id: Optional[str]
    session_timestamp_local: Optional[datetime]
    session_timestamp_utc: Optional[datetime]
    cwd: Optional[str]
    originator: Optional[str]
    cli_version: Optional[str]
    source: Optional[str]
    model_provider: Optional[str]
    git_commit_hash: Optional[str]
    git_branch: Optional[str]
    git_repository_url: Optional[str]


@dataclass
class ParsedTurnContext:
    captured_at_local: datetime
    captured_at_utc: datetime
    model: Optional[str]
    cwd: Optional[str]
    approval_policy: Optional[str]
    sandbox_policy_type: Optional[str]
    sandbox_network_access: Optional[bool]
    sandbox_writable_roots: Optional[str]
    sandbox_exclude_tmpdir_env_var: Optional[bool]
    sandbox_exclude_slash_tmp: Optional[bool]
    truncation_policy_mode: Optional[str]
    truncation_policy_limit: Optional[int]
    reasoning_effort: Optional[str]
    reasoning_summary: Optional[str]
    has_base_instructions: bool
    has_user_instructions: bool
    has_developer_instructions: bool
    has_final_output_json_schema: bool


@dataclass
class ParsedEventMarker:
    captured_at_local: datetime
    captured_at_utc: datetime
    event_type: str


@dataclass
class ParsedActivityEvent:
    captured_at_local: datetime
    captured_at_utc: datetime
    event_type: str
    event_name: Optional[str] = None
    count: int = 1


@dataclass
class ParsedMessage:
    captured_at_local: datetime
    captured_at_utc: datetime
    role: str
    message_type: str
    message: str


@dataclass
class ParsedToolCall:
    captured_at_local: datetime
    captured_at_utc: datetime
    tool_type: str
    tool_name: Optional[str]
    call_id: Optional[str]
    status: Optional[str]
    input_text: Optional[str]
    output_text: Optional[str]
    command: Optional[str]


@dataclass
class ParsedTokenCount:
    captured_at_local: datetime
    captured_at_utc: datetime
    tokens: Dict[str, int]
    lifetime_tokens: Dict[str, Optional[int]]
    context_used: Optional[int]
    context_total: Optional[int]
    context_percent_left: Optional[int]
    limit_5h_percent_left: Optional[float]
    limit_5h_resets_at: Optional[str]
    limit_weekly_percent_left: Optional[float]
    limit_weekly_resets_at: Optional[str]
    limit_5h_used_percent: Optional[float]
    limit_5h_window_minutes: Optional[int]
    limit_5h_resets_at_seconds: Optional[int]
    limit_weekly_used_percent: Optional[float]
    limit_weekly_window_minutes: Optional[int]
    limit_weekly_resets_at_seconds: Optional[int]
    rate_limit_has_credits: Optional[bool]
    rate_limit_unlimited: Optional[bool]
    rate_limit_balance: Optional[str]
    rate_limit_plan_type: Optional[str]


@dataclass
class ParsedRolloutItem:
    token_count: Optional[ParsedTokenCount] = None
    session_meta: Optional[ParsedSessionMeta] = None
    turn_context: Optional[ParsedTurnContext] = None
    event_marker: Optional[ParsedEventMarker] = None
    activity_events: List[ParsedActivityEvent] = field(default_factory=list)
    messages: List[ParsedMessage] = field(default_factory=list)
    tool_calls: List[ParsedToolCall] = field(default_factory=list)

    def is_empty(self) -> bool:
        return (
            self.token_count is None
            and self.session_meta is None
            and self.turn_context is None
            and self.event_marker is None
            and not self.activity_events
            and not self.messages
            and not self.tool_calls
        )


def iter_rollout_files(root: Path) -> Iterator[Path]:
    if not root.exists():
        return
    for path in root.rglob("rollout-*.jsonl"):
        if path.is_file():
            yield path


def parse_rollout_timestamp(value: str) -> datetime:
    value = value.strip()
    if value.endswith("Z"):
        value = value[:-1] + "+00:00"
    dt = datetime.fromisoformat(value)
    if dt.tzinfo is None:
        return dt.replace(tzinfo=ZoneInfo("UTC"))
    return dt


def _format_reset_timestamp(
    reset_seconds: Optional[int],
    captured_at: datetime,
    tz: ZoneInfo,
) -> Optional[str]:
    if reset_seconds is None:
        return None
    dt = datetime.fromtimestamp(reset_seconds, tz=ZoneInfo("UTC")).astimezone(tz)
    captured_local = captured_at.astimezone(tz)
    time_text = dt.strftime("%H:%M")
    if dt.date() == captured_local.date():
        return time_text
    day_text = dt.strftime("%-d %b")
    return f"{time_text} on {day_text}"


def _percent_left(used_percent: Optional[float]) -> Optional[float]:
    if used_percent is None:
        return None
    return max(0.0, min(100.0, 100.0 - used_percent))


def _context_percent_left(total_tokens: Optional[int], context_window: Optional[int]) -> Optional[int]:
    if total_tokens is None or context_window is None:
        return None
    if context_window <= BASELINE_TOKENS:
        return 0
    effective_window = context_window - BASELINE_TOKENS
    used = max(0, total_tokens - BASELINE_TOKENS)
    remaining = max(0, effective_window - used)
    return int(round((remaining / effective_window) * 100.0))


def _parse_optional_timestamp(
    value: Optional[str],
    tz: ZoneInfo,
) -> Tuple[Optional[datetime], Optional[datetime]]:
    if not value:
        return None, None
    try:
        parsed = parse_rollout_timestamp(value)
    except ValueError:
        return None, None
    return parsed.astimezone(tz), parsed


def _coerce_bool(value: Optional[object]) -> Optional[bool]:
    if isinstance(value, bool):
        return value
    if isinstance(value, str):
        lowered = value.lower()
        if lowered in ("true", "yes", "1"):
            return True
        if lowered in ("false", "no", "0"):
            return False
    return None


def _coerce_int(value: Optional[object]) -> Optional[int]:
    if value is None:
        return None
    try:
        return int(value)
    except (TypeError, ValueError):
        return None


def _parse_session_source(value: Optional[object]) -> Optional[str]:
    if isinstance(value, str):
        return value
    if isinstance(value, dict):
        if "subagent" in value:
            return "subagent"
        if len(value) == 1:
            return next(iter(value.keys()))
    return None


def _parse_sandbox_policy(
    policy: Optional[object],
) -> Tuple[Optional[str], Optional[bool], Optional[str], Optional[bool], Optional[bool]]:
    if policy is None:
        return None, None, None, None, None
    if isinstance(policy, str):
        return policy, None, None, None, None
    if not isinstance(policy, dict):
        return None, None, None, None, None
    policy_type = policy.get("type")
    network_access = policy.get("network_access")
    network_access_bool = None
    if isinstance(network_access, bool):
        network_access_bool = network_access
    elif isinstance(network_access, str):
        lowered = network_access.lower()
        if lowered == "enabled":
            network_access_bool = True
        elif lowered == "restricted":
            network_access_bool = False
    writable_roots = policy.get("writable_roots")
    roots_serialized = None
    if isinstance(writable_roots, list):
        roots_serialized = json.dumps([str(root) for root in writable_roots])
    exclude_tmpdir_env_var = _coerce_bool(policy.get("exclude_tmpdir_env_var"))
    exclude_slash_tmp = _coerce_bool(policy.get("exclude_slash_tmp"))
    return (
        policy_type,
        network_access_bool,
        roots_serialized,
        exclude_tmpdir_env_var,
        exclude_slash_tmp,
    )


def _command_name(command: Optional[object]) -> Optional[str]:
    if isinstance(command, list) and command:
        first = command[0]
        return first if isinstance(first, str) else None
    if isinstance(command, str):
        command = command.strip()
        if not command:
            return None
        return command.split()[0]
    return None


def _stringify(value: Optional[object]) -> Optional[str]:
    if value is None:
        return None
    if isinstance(value, str):
        return value
    try:
        return json.dumps(value, ensure_ascii=True)
    except (TypeError, ValueError):
        return None


STATE_CHANGE_EVENTS = {
    "context_compacted",
    "thread_rolled_back",
    "undo_completed",
    "turn_aborted",
    "entered_review_mode",
    "exited_review_mode",
}


def parse_rollout_line(
    raw: str,
    context: RolloutContext,
    tz: ZoneInfo = DEFAULT_TZ,
) -> Tuple[Optional[ParsedRolloutItem], RolloutContext]:
    data = json.loads(raw)
    item_type = data.get("type")
    payload = data.get("payload") or {}

    timestamp = data.get("timestamp")
    captured_at_utc = parse_rollout_timestamp(timestamp) if timestamp else None
    captured_at_local = captured_at_utc.astimezone(tz) if captured_at_utc else None

    if item_type == "session_meta":
        if captured_at_local is None or captured_at_utc is None:
            return None, context
        context.session_id = payload.get("id") or context.session_id
        context.directory = payload.get("cwd") or context.directory
        context.codex_version = payload.get("cli_version") or context.codex_version
        session_timestamp_local, session_timestamp_utc = _parse_optional_timestamp(
            payload.get("timestamp"),
            tz,
        )
        git = payload.get("git") if isinstance(payload.get("git"), dict) else {}
        item = ParsedRolloutItem(
            session_meta=ParsedSessionMeta(
                captured_at_local=captured_at_local,
                captured_at_utc=captured_at_utc,
                session_id=payload.get("id"),
                session_timestamp_local=session_timestamp_local,
                session_timestamp_utc=session_timestamp_utc,
                cwd=payload.get("cwd"),
                originator=payload.get("originator"),
                cli_version=payload.get("cli_version"),
                source=_parse_session_source(payload.get("source")),
                model_provider=payload.get("model_provider"),
                git_commit_hash=git.get("commit_hash") if isinstance(git, dict) else None,
                git_branch=git.get("branch") if isinstance(git, dict) else None,
                git_repository_url=git.get("repository_url") if isinstance(git, dict) else None,
            )
        )
        return item, context

    if item_type == "turn_context":
        if captured_at_local is None or captured_at_utc is None:
            return None, context
        context.model = payload.get("model") or context.model
        context.directory = payload.get("cwd") or context.directory
        (
            sandbox_type,
            sandbox_network_access,
            sandbox_writable_roots,
            sandbox_exclude_tmpdir_env_var,
            sandbox_exclude_slash_tmp,
        ) = _parse_sandbox_policy(payload.get("sandbox_policy"))
        truncation_policy = payload.get("truncation_policy")
        truncation_mode = None
        truncation_limit = None
        if isinstance(truncation_policy, dict):
            truncation_mode = truncation_policy.get("mode")
            limit_value = truncation_policy.get("limit")
            if limit_value is not None:
                try:
                    truncation_limit = int(limit_value)
                except (TypeError, ValueError):
                    truncation_limit = None
        item = ParsedRolloutItem(
            turn_context=ParsedTurnContext(
                captured_at_local=captured_at_local,
                captured_at_utc=captured_at_utc,
                model=payload.get("model"),
                cwd=payload.get("cwd"),
                approval_policy=payload.get("approval_policy"),
                sandbox_policy_type=sandbox_type,
                sandbox_network_access=sandbox_network_access,
                sandbox_writable_roots=sandbox_writable_roots,
                sandbox_exclude_tmpdir_env_var=sandbox_exclude_tmpdir_env_var,
                sandbox_exclude_slash_tmp=sandbox_exclude_slash_tmp,
                truncation_policy_mode=truncation_mode,
                truncation_policy_limit=truncation_limit,
                reasoning_effort=payload.get("effort"),
                reasoning_summary=payload.get("summary"),
                has_base_instructions=bool(payload.get("base_instructions")),
                has_user_instructions=bool(payload.get("user_instructions")),
                has_developer_instructions=bool(payload.get("developer_instructions")),
                has_final_output_json_schema=payload.get("final_output_json_schema")
                is not None,
            )
        )
        return item, context

    if item_type == "response_item":
        if not isinstance(payload, dict):
            return None, context
        if captured_at_local is None or captured_at_utc is None:
            return None, context
        response_type = payload.get("type")
        activity_events: List[ParsedActivityEvent] = []
        messages: List[ParsedMessage] = []
        tool_calls: List[ParsedToolCall] = []
        if response_type == "message":
            role = payload.get("role")
            if role == "user":
                activity_events.append(
                    ParsedActivityEvent(
                        captured_at_local=captured_at_local,
                        captured_at_utc=captured_at_utc,
                        event_type="user_message",
                        event_name="response_item",
                    )
                )
            elif role == "assistant":
                activity_events.append(
                    ParsedActivityEvent(
                        captured_at_local=captured_at_local,
                        captured_at_utc=captured_at_utc,
                        event_type="assistant_message",
                        event_name="response_item",
                    )
                )
            content = payload.get("content")
            if isinstance(role, str) and isinstance(content, list):
                parts = []
                for item in content:
                    if not isinstance(item, dict):
                        continue
                    item_type = item.get("type")
                    if item_type in ("input_text", "output_text"):
                        text = item.get("text")
                        if isinstance(text, str) and text:
                            parts.append(text)
                if parts:
                    messages.append(
                        ParsedMessage(
                            captured_at_local=captured_at_local,
                            captured_at_utc=captured_at_utc,
                            role=role,
                            message_type="response_item",
                            message="".join(parts),
                        )
                    )
        elif response_type == "local_shell_call":
            activity_events.append(
                ParsedActivityEvent(
                    captured_at_local=captured_at_local,
                    captured_at_utc=captured_at_utc,
                    event_type="tool_call",
                    event_name="local_shell",
                )
            )
            action = payload.get("action") if isinstance(payload.get("action"), dict) else {}
            if action.get("type") == "exec":
                command_name = _command_name(action.get("command"))
                if command_name:
                    activity_events.append(
                        ParsedActivityEvent(
                            captured_at_local=captured_at_local,
                            captured_at_utc=captured_at_utc,
                            event_type="shell_command",
                            event_name=command_name,
                        )
                    )
            command_text = None
            if action.get("type") == "exec":
                command_text = _stringify(action.get("command"))
            tool_calls.append(
                ParsedToolCall(
                    captured_at_local=captured_at_local,
                    captured_at_utc=captured_at_utc,
                    tool_type="local_shell",
                    tool_name=None,
                    call_id=_stringify(payload.get("call_id")),
                    status=_stringify(payload.get("status")),
                    input_text=_stringify(action) if action else None,
                    output_text=None,
                    command=command_text,
                )
            )
        elif response_type == "function_call":
            activity_events.append(
                ParsedActivityEvent(
                    captured_at_local=captured_at_local,
                    captured_at_utc=captured_at_utc,
                    event_type="tool_call",
                    event_name="function",
                )
            )
            name = payload.get("name")
            if isinstance(name, str) and name:
                activity_events.append(
                    ParsedActivityEvent(
                        captured_at_local=captured_at_local,
                        captured_at_utc=captured_at_utc,
                        event_type="tool_name",
                        event_name=name,
                    )
                )
            tool_calls.append(
                ParsedToolCall(
                    captured_at_local=captured_at_local,
                    captured_at_utc=captured_at_utc,
                    tool_type="function_call",
                    tool_name=_stringify(name),
                    call_id=_stringify(payload.get("call_id")),
                    status=_stringify(payload.get("status")),
                    input_text=_stringify(payload.get("arguments")),
                    output_text=None,
                    command=None,
                )
            )
        elif response_type == "function_call_output":
            tool_calls.append(
                ParsedToolCall(
                    captured_at_local=captured_at_local,
                    captured_at_utc=captured_at_utc,
                    tool_type="function_call_output",
                    tool_name=None,
                    call_id=_stringify(payload.get("call_id")),
                    status=None,
                    input_text=None,
                    output_text=_stringify(payload.get("output")),
                    command=None,
                )
            )
        elif response_type == "custom_tool_call":
            activity_events.append(
                ParsedActivityEvent(
                    captured_at_local=captured_at_local,
                    captured_at_utc=captured_at_utc,
                    event_type="tool_call",
                    event_name="custom_tool",
                )
            )
            name = payload.get("name")
            if isinstance(name, str) and name:
                activity_events.append(
                    ParsedActivityEvent(
                        captured_at_local=captured_at_local,
                        captured_at_utc=captured_at_utc,
                        event_type="tool_name",
                        event_name=name,
                    )
                )
            tool_calls.append(
                ParsedToolCall(
                    captured_at_local=captured_at_local,
                    captured_at_utc=captured_at_utc,
                    tool_type="custom_tool_call",
                    tool_name=_stringify(name),
                    call_id=_stringify(payload.get("call_id")),
                    status=_stringify(payload.get("status")),
                    input_text=_stringify(payload.get("input")),
                    output_text=None,
                    command=None,
                )
            )
        elif response_type == "custom_tool_call_output":
            tool_calls.append(
                ParsedToolCall(
                    captured_at_local=captured_at_local,
                    captured_at_utc=captured_at_utc,
                    tool_type="custom_tool_call_output",
                    tool_name=None,
                    call_id=_stringify(payload.get("call_id")),
                    status=None,
                    input_text=None,
                    output_text=_stringify(payload.get("output")),
                    command=None,
                )
            )
        elif response_type == "web_search_call":
            activity_events.append(
                ParsedActivityEvent(
                    captured_at_local=captured_at_local,
                    captured_at_utc=captured_at_utc,
                    event_type="tool_call",
                    event_name="web_search",
                )
            )
            action = payload.get("action") if isinstance(payload.get("action"), dict) else {}
            tool_calls.append(
                ParsedToolCall(
                    captured_at_local=captured_at_local,
                    captured_at_utc=captured_at_utc,
                    tool_type="web_search_call",
                    tool_name=_stringify(action.get("type")),
                    call_id=None,
                    status=_stringify(payload.get("status")),
                    input_text=_stringify(action),
                    output_text=None,
                    command=None,
                )
            )
        elif response_type in ("compaction", "compaction_summary"):
            activity_events.append(
                ParsedActivityEvent(
                    captured_at_local=captured_at_local,
                    captured_at_utc=captured_at_utc,
                    event_type="tool_call",
                    event_name="compaction",
                )
            )

        if activity_events or messages or tool_calls:
            return (
                ParsedRolloutItem(
                    activity_events=activity_events,
                    messages=messages,
                    tool_calls=tool_calls,
                ),
                context,
            )
        return None, context

    if item_type != "event_msg":
        return None, context

    event_type = payload.get("type")
    event_payload = payload.get("payload") if isinstance(payload.get("payload"), dict) else payload
    if not isinstance(event_payload, dict):
        event_payload = {}
    if event_type != "token_count":
        if captured_at_local is None or captured_at_utc is None:
            return None, context
        activity_events: List[ParsedActivityEvent] = []
        messages: List[ParsedMessage] = []
        if event_type == "user_message":
            message = event_payload.get("message")
            if isinstance(message, str) and message:
                messages.append(
                    ParsedMessage(
                        captured_at_local=captured_at_local,
                        captured_at_utc=captured_at_utc,
                        role="user",
                        message_type="event_msg",
                        message=message,
                    )
                )
            activity_events.append(
                ParsedActivityEvent(
                    captured_at_local=captured_at_local,
                    captured_at_utc=captured_at_utc,
                    event_type="user_message",
                    event_name="event_msg",
                )
            )
            images = event_payload.get("images")
            if isinstance(images, list) and images:
                activity_events.append(
                    ParsedActivityEvent(
                        captured_at_local=captured_at_local,
                        captured_at_utc=captured_at_utc,
                        event_type="user_image",
                        event_name="event_msg",
                        count=len(images),
                    )
                )
            local_images = event_payload.get("local_images")
            if isinstance(local_images, list) and local_images:
                activity_events.append(
                    ParsedActivityEvent(
                        captured_at_local=captured_at_local,
                        captured_at_utc=captured_at_utc,
                        event_type="user_local_image",
                        event_name="event_msg",
                        count=len(local_images),
                    )
                )
        elif event_type == "agent_message":
            message = event_payload.get("message")
            if isinstance(message, str) and message:
                messages.append(
                    ParsedMessage(
                        captured_at_local=captured_at_local,
                        captured_at_utc=captured_at_utc,
                        role="assistant",
                        message_type="event_msg",
                        message=message,
                    )
                )
            activity_events.append(
                ParsedActivityEvent(
                    captured_at_local=captured_at_local,
                    captured_at_utc=captured_at_utc,
                    event_type="assistant_message",
                    event_name="event_msg",
                )
            )
        elif event_type == "agent_reasoning":
            message = event_payload.get("text")
            if isinstance(message, str) and message:
                messages.append(
                    ParsedMessage(
                        captured_at_local=captured_at_local,
                        captured_at_utc=captured_at_utc,
                        role="reasoning",
                        message_type="event_msg",
                        message=message,
                    )
                )
            activity_events.append(
                ParsedActivityEvent(
                    captured_at_local=captured_at_local,
                    captured_at_utc=captured_at_utc,
                    event_type="reasoning_event",
                    event_name="event_msg",
                )
            )
        elif event_type == "agent_reasoning_raw_content":
            message = event_payload.get("text")
            if isinstance(message, str) and message:
                messages.append(
                    ParsedMessage(
                        captured_at_local=captured_at_local,
                        captured_at_utc=captured_at_utc,
                        role="reasoning_raw",
                        message_type="event_msg",
                        message=message,
                    )
                )
            activity_events.append(
                ParsedActivityEvent(
                    captured_at_local=captured_at_local,
                    captured_at_utc=captured_at_utc,
                    event_type="reasoning_raw_event",
                    event_name="event_msg",
                )
            )

        if activity_events or messages:
            return (
                ParsedRolloutItem(activity_events=activity_events, messages=messages),
                context,
            )

        if event_type in STATE_CHANGE_EVENTS:
            return (
                ParsedRolloutItem(
                    event_marker=ParsedEventMarker(
                        captured_at_local=captured_at_local,
                        captured_at_utc=captured_at_utc,
                        event_type=event_type,
                    )
                ),
                context,
            )
        return None, context

    info = event_payload.get("info") or {}
    if info is None:
        return None, context
    last_usage = info.get("last_token_usage") or {}
    total_usage = info.get("total_token_usage") or {}
    model_context_window = info.get("model_context_window")

    if captured_at_local is None or captured_at_utc is None:
        return None, context

    tokens = {
        "total_tokens": int(last_usage.get("total_tokens") or 0),
        "input_tokens": int(last_usage.get("input_tokens") or 0),
        "cached_input_tokens": int(last_usage.get("cached_input_tokens") or 0),
        "output_tokens": int(last_usage.get("output_tokens") or 0),
        "reasoning_output_tokens": int(last_usage.get("reasoning_output_tokens") or 0),
    }

    lifetime_tokens = {
        "total_tokens": int(total_usage.get("total_tokens"))
        if total_usage.get("total_tokens") is not None
        else None,
        "input_tokens": int(total_usage.get("input_tokens"))
        if total_usage.get("input_tokens") is not None
        else None,
        "cached_input_tokens": int(total_usage.get("cached_input_tokens"))
        if total_usage.get("cached_input_tokens") is not None
        else None,
        "output_tokens": int(total_usage.get("output_tokens"))
        if total_usage.get("output_tokens") is not None
        else None,
        "reasoning_output_tokens": int(total_usage.get("reasoning_output_tokens"))
        if total_usage.get("reasoning_output_tokens") is not None
        else None,
    }

    context_used = total_usage.get("total_tokens")
    if context_used is not None:
        context_used = int(context_used)

    if model_context_window is not None:
        model_context_window = int(model_context_window)

    context_percent_left = _context_percent_left(context_used, model_context_window)

    limits = event_payload.get("rate_limits") or {}
    primary = limits.get("primary") or {}
    secondary = limits.get("secondary") or {}
    primary_used = primary.get("used_percent")
    secondary_used = secondary.get("used_percent")

    limit_5h_percent_left = _percent_left(primary_used)
    limit_weekly_percent_left = _percent_left(secondary_used)

    limit_5h_resets_at = _format_reset_timestamp(
        primary.get("resets_at"), captured_at_local, tz
    )
    limit_weekly_resets_at = _format_reset_timestamp(
        secondary.get("resets_at"), captured_at_local, tz
    )

    credits = limits.get("credits") or {}
    plan_type = limits.get("plan_type")

    parsed = ParsedTokenCount(
        captured_at_local=captured_at_local,
        captured_at_utc=captured_at_utc,
        tokens=tokens,
        lifetime_tokens=lifetime_tokens,
        context_used=context_used,
        context_total=model_context_window,
        context_percent_left=context_percent_left,
        limit_5h_percent_left=limit_5h_percent_left,
        limit_5h_resets_at=limit_5h_resets_at,
        limit_weekly_percent_left=limit_weekly_percent_left,
        limit_weekly_resets_at=limit_weekly_resets_at,
        limit_5h_used_percent=primary_used,
        limit_5h_window_minutes=_coerce_int(primary.get("window_minutes")),
        limit_5h_resets_at_seconds=_coerce_int(primary.get("resets_at")),
        limit_weekly_used_percent=secondary_used,
        limit_weekly_window_minutes=_coerce_int(secondary.get("window_minutes")),
        limit_weekly_resets_at_seconds=_coerce_int(secondary.get("resets_at")),
        rate_limit_has_credits=credits.get("has_credits")
        if isinstance(credits, dict)
        else None,
        rate_limit_unlimited=credits.get("unlimited")
        if isinstance(credits, dict)
        else None,
        rate_limit_balance=credits.get("balance") if isinstance(credits, dict) else None,
        rate_limit_plan_type=plan_type if plan_type is not None else None,
    )
    return ParsedRolloutItem(token_count=parsed), context
