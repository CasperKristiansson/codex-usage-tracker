import json
from datetime import datetime, timedelta, timezone
from pathlib import Path
import sys

sys.path.append(str(Path(__file__).resolve().parents[3] / "src"))

from codex_usage_tracker.store import (
    ActivityEvent,
    AppItemMetric,
    MessageEvent,
    SessionMeta,
    ToolCallEvent,
    TurnContext,
    UsageEvent,
    UsageStore,
)

SOURCE = "fixture"


def iso(dt: datetime) -> str:
    return dt.replace(microsecond=0).isoformat()


def ensure_parent(path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)


def write_config(db_path: Path) -> None:
    config_path = db_path.parent / "config.json"
    config_path.write_text(json.dumps({"timezone": "UTC"}, indent=2))


def build_sessions(now: datetime):
    sessions = [
        SessionMeta(
            session_id="session-alpha",
            session_timestamp=iso(now - timedelta(days=2, hours=2)),
            session_timestamp_utc=iso(now - timedelta(days=2, hours=2)),
            cwd="/work/alpha",
            originator="cli",
            cli_version="0.10.2",
            source=SOURCE,
            model_provider="openai",
            git_commit_hash="abc123",
            git_branch="main",
            git_repository_url="https://example.com/repo-alpha.git",
            captured_at=iso(now - timedelta(days=2, hours=2)),
            captured_at_utc=iso(now - timedelta(days=2, hours=2)),
            rollout_source="rollout",
        ),
        SessionMeta(
            session_id="session-beta",
            session_timestamp=iso(now - timedelta(days=1, hours=4)),
            session_timestamp_utc=iso(now - timedelta(days=1, hours=4)),
            cwd="/work/beta",
            originator="cli",
            cli_version="0.10.2",
            source=SOURCE,
            model_provider="openai",
            git_commit_hash="def456",
            git_branch="feature/refresh",
            git_repository_url="https://example.com/repo-beta.git",
            captured_at=iso(now - timedelta(days=1, hours=4)),
            captured_at_utc=iso(now - timedelta(days=1, hours=4)),
            rollout_source="rollout",
        ),
    ]
    return sessions


def build_turns(now: datetime):
    turns = []
    turn_specs = [
        ("session-alpha", 1, "gpt-5.1-codex", "/work/alpha", now - timedelta(days=2, hours=1)),
        ("session-alpha", 2, "gpt-5.1-codex", "/work/alpha", now - timedelta(days=2, hours=0, minutes=10)),
        ("session-alpha", 3, "gpt-5.1-codex", "/work/alpha", now - timedelta(days=1, hours=20)),
        ("session-beta", 1, "gpt-5.2-codex", "/work/beta", now - timedelta(days=1, hours=3)),
        ("session-beta", 2, "gpt-5.2-codex", "/work/beta", now - timedelta(days=1, hours=1, minutes=30)),
        ("session-beta", 3, "gpt-5.1-codex-max", "/work/beta", now - timedelta(hours=6)),
    ]
    for session_id, turn_index, model, cwd, ts in turn_specs:
        turns.append(
            TurnContext(
                captured_at=iso(ts),
                captured_at_utc=iso(ts),
                session_id=session_id,
                turn_index=turn_index,
                model=model,
                cwd=cwd,
                approval_policy="on-request",
                sandbox_policy_type="workspace-write",
                sandbox_network_access=True,
                sandbox_writable_roots="/tmp",
                sandbox_exclude_tmpdir_env_var=True,
                sandbox_exclude_slash_tmp=False,
                truncation_policy_mode="tokens",
                truncation_policy_limit=4096,
                reasoning_effort="high",
                reasoning_summary="concise",
                has_base_instructions=True,
                has_user_instructions=True,
                has_developer_instructions=True,
                has_final_output_json_schema=False,
                source=SOURCE,
            )
        )
    return turns


def build_events(now: datetime):
    events = []
    token_specs = [
        ("session-alpha", "gpt-5.1-codex", "/work/alpha", now - timedelta(days=2, hours=1), 1200, 200, 300, 100, 16000, 24000, 33.3, 70, 90),
        ("session-alpha", "gpt-5.1-codex", "/work/alpha", now - timedelta(days=2, hours=0, minutes=10), 900, 150, 250, 60, 15000, 24000, 37.5, 68, 88),
        ("session-alpha", "gpt-5.1-codex", "/work/alpha", now - timedelta(days=1, hours=20), 1400, 300, 400, 90, 18000, 24000, 25.0, 62, 82),
        ("session-beta", "gpt-5.2-codex", "/work/beta", now - timedelta(days=1, hours=3), 2000, 300, 500, 120, 17000, 32000, 46.9, 72, 91),
        ("session-beta", "gpt-5.2-codex", "/work/beta", now - timedelta(days=1, hours=1, minutes=30), 1800, 280, 450, 110, 19000, 32000, 40.6, 69, 87),
        ("session-beta", "gpt-5.1-codex-max", "/work/beta", now - timedelta(hours=6), 2200, 400, 550, 140, 21000, 32000, 34.4, 64, 80),
    ]

    for session_id, model, directory, ts, input_tokens, cached_tokens, output_tokens, reasoning_tokens, context_used, context_total, context_left, limit_5h, limit_weekly in token_specs:
        total = input_tokens + cached_tokens + output_tokens + reasoning_tokens
        events.append(
            UsageEvent(
                captured_at=iso(ts),
                captured_at_utc=iso(ts),
                event_type="token_count",
                total_tokens=total,
                input_tokens=input_tokens,
                cached_input_tokens=cached_tokens,
                output_tokens=output_tokens,
                reasoning_output_tokens=reasoning_tokens,
                lifetime_total_tokens=total * 10,
                lifetime_input_tokens=input_tokens * 10,
                lifetime_cached_input_tokens=cached_tokens * 10,
                lifetime_output_tokens=output_tokens * 10,
                lifetime_reasoning_output_tokens=reasoning_tokens * 10,
                context_used=context_used,
                context_total=context_total,
                context_percent_left=context_left,
                limit_5h_percent_left=limit_5h,
                limit_5h_resets_at="18:00",
                limit_weekly_percent_left=limit_weekly,
                limit_weekly_resets_at="12:00 on 16 Jan",
                limit_5h_used_percent=100 - limit_5h,
                limit_5h_window_minutes=300,
                limit_5h_resets_at_seconds=1735725600,
                limit_weekly_used_percent=100 - limit_weekly,
                limit_weekly_window_minutes=10080,
                limit_weekly_resets_at_seconds=1735812000,
                rate_limit_has_credits=True,
                rate_limit_unlimited=False,
                rate_limit_balance="4.20",
                rate_limit_plan_type="pro",
                model=model,
                directory=directory,
                session_id=session_id,
                codex_version="0.10.2",
                source=SOURCE,
            )
        )

    friction_specs = [
        ("context_compacted", "session-alpha", "gpt-5.1-codex", "/work/alpha", now - timedelta(days=2, hours=0, minutes=30)),
        ("turn_aborted", "session-beta", "gpt-5.2-codex", "/work/beta", now - timedelta(days=1, hours=2, minutes=10)),
    ]
    for event_type, session_id, model, directory, ts in friction_specs:
        events.append(
            UsageEvent(
                captured_at=iso(ts),
                captured_at_utc=iso(ts),
                event_type=event_type,
                model=model,
                directory=directory,
                session_id=session_id,
                codex_version="0.10.2",
                source=SOURCE,
            )
        )

    return events


def build_activity_events(now: datetime):
    return [
        ActivityEvent(
            captured_at=iso(now - timedelta(days=1, hours=3, minutes=5)),
            captured_at_utc=iso(now - timedelta(days=1, hours=3, minutes=5)),
            event_type="tool_call",
            event_name="local_shell",
            count=2,
            session_id="session-alpha",
            turn_index=1,
            source=SOURCE,
        )
    ]


def build_tool_calls(now: datetime):
    return [
        ToolCallEvent(
            captured_at=iso(now - timedelta(days=2, hours=1, minutes=5)),
            captured_at_utc=iso(now - timedelta(days=2, hours=1, minutes=5)),
            tool_type="local_shell",
            tool_name="git",
            call_id="call-1",
            status="completed",
            input_text="git status",
            output_text="clean",
            command="git status",
            session_id="session-alpha",
            turn_index=1,
            source=SOURCE,
        ),
        ToolCallEvent(
            captured_at=iso(now - timedelta(days=1, hours=3, minutes=20)),
            captured_at_utc=iso(now - timedelta(days=1, hours=3, minutes=20)),
            tool_type="web_search",
            tool_name="search",
            call_id="call-2",
            status="failed",
            input_text="query=codex",
            output_text="timeout",
            command=None,
            session_id="session-beta",
            turn_index=1,
            source=SOURCE,
        ),
        ToolCallEvent(
            captured_at=iso(now - timedelta(hours=6, minutes=15)),
            captured_at_utc=iso(now - timedelta(hours=6, minutes=15)),
            tool_type="browser",
            tool_name="open_page",
            call_id="call-3",
            status="completed",
            input_text="https://example.com",
            output_text="200",
            command=None,
            session_id="session-beta",
            turn_index=3,
            source=SOURCE,
        ),
    ]


def build_messages(now: datetime):
    return [
        MessageEvent(
            captured_at=iso(now - timedelta(days=2, hours=1, minutes=1)),
            captured_at_utc=iso(now - timedelta(days=2, hours=1, minutes=1)),
            role="user",
            message_type="user_message",
            message="Show me token usage.",
            session_id="session-alpha",
            turn_index=1,
            source=SOURCE,
        ),
        MessageEvent(
            captured_at=iso(now - timedelta(days=2, hours=1, minutes=0)),
            captured_at_utc=iso(now - timedelta(days=2, hours=1, minutes=0)),
            role="assistant",
            message_type="assistant_message",
            message="Here is a summary of token usage.",
            session_id="session-alpha",
            turn_index=1,
            source=SOURCE,
        ),
    ]


def build_app_items(now: datetime):
    return [
        AppItemMetric(
            thread_id="thread-1",
            turn_id="turn-1",
            item_id="item-1",
            item_type="commandExecution",
            status="completed",
            started_at=iso(now - timedelta(days=2, hours=1, minutes=6)),
            completed_at=iso(now - timedelta(days=2, hours=1, minutes=5)),
            duration_ms=1200,
            command_name="git",
            exit_code=0,
            output_bytes=128,
            tool_name=None,
            web_search_action=None,
            source=SOURCE,
        ),
        AppItemMetric(
            thread_id="thread-2",
            turn_id="turn-2",
            item_id="item-2",
            item_type="toolCall",
            status="completed",
            started_at=iso(now - timedelta(days=1, hours=3, minutes=21)),
            completed_at=iso(now - timedelta(days=1, hours=3, minutes=19)),
            duration_ms=2100,
            command_name=None,
            exit_code=None,
            output_bytes=None,
            tool_name="web_search",
            web_search_action="search",
            source=SOURCE,
        ),
    ]


def main(db_path_str: str) -> None:
    db_path = Path(db_path_str)
    ensure_parent(db_path)
    if db_path.exists():
        db_path.unlink()

    now = datetime.now(timezone.utc)
    store = UsageStore(db_path)

    write_config(db_path)

    for session in build_sessions(now):
        store.upsert_session(session, commit=False)
    store.conn.commit()

    store.insert_turns_bulk(build_turns(now))
    store.insert_events_bulk(build_events(now))
    store.insert_activity_events_bulk(build_activity_events(now))
    store.insert_tool_calls_bulk(build_tool_calls(now))
    store.insert_messages_bulk(build_messages(now))
    store.insert_app_items_bulk(build_app_items(now))

    store.conn.execute(
        """
        CREATE TABLE IF NOT EXISTS session_annotations (
            session_id TEXT PRIMARY KEY,
            note TEXT,
            updated_at TEXT
        )
        """
    )
    store.conn.execute(
        """
        CREATE TABLE IF NOT EXISTS session_tags (
            session_id TEXT NOT NULL,
            tag TEXT NOT NULL,
            updated_at TEXT,
            PRIMARY KEY (session_id, tag)
        )
        """
    )
    store.conn.execute(
        "CREATE INDEX IF NOT EXISTS session_tags_session_idx ON session_tags(session_id)"
    )
    store.conn.execute(
        "CREATE INDEX IF NOT EXISTS session_tags_tag_idx ON session_tags(tag)"
    )

    week_start = (now - timedelta(days=7)).date().isoformat()
    week_end = now.date().isoformat()
    store.upsert_weekly_quota(
        week_start=week_start,
        week_end=week_end,
        quota_tokens=500000,
        quota_cost=12.34,
        used_percent=42.0,
        observed_tokens=210000,
        observed_cost=5.18,
        computed_at=iso(now),
    )

    # Switch away from WAL so readonly connections don't need shm/wal files.
    try:
        store.conn.execute("PRAGMA wal_checkpoint(TRUNCATE)")
        store.conn.execute("PRAGMA journal_mode=DELETE")
    except Exception:
        pass

    store.close()

    for suffix in ("-shm", "-wal"):
        extra = db_path.with_name(db_path.name + suffix)
        if extra.exists():
            extra.unlink()


if __name__ == "__main__":
    if len(sys.argv) < 2:
        raise SystemExit("Usage: generate_fixture_db.py /path/to/usage.sqlite")
    main(sys.argv[1])
