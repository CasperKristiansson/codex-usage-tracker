import sqlite3
from contextlib import contextmanager
from datetime import datetime
from dataclasses import dataclass
from pathlib import Path
from typing import Iterable, Optional

SCHEMA_VERSION = 6
INGEST_VERSION = 5


@dataclass
class UsageEvent:
    captured_at: str
    captured_at_utc: str
    event_type: str
    total_tokens: Optional[int] = None
    input_tokens: Optional[int] = None
    cached_input_tokens: Optional[int] = None
    output_tokens: Optional[int] = None
    reasoning_output_tokens: Optional[int] = None
    lifetime_total_tokens: Optional[int] = None
    lifetime_input_tokens: Optional[int] = None
    lifetime_cached_input_tokens: Optional[int] = None
    lifetime_output_tokens: Optional[int] = None
    lifetime_reasoning_output_tokens: Optional[int] = None
    context_used: Optional[int] = None
    context_total: Optional[int] = None
    context_percent_left: Optional[float] = None
    limit_5h_percent_left: Optional[float] = None
    limit_5h_resets_at: Optional[str] = None
    limit_weekly_percent_left: Optional[float] = None
    limit_weekly_resets_at: Optional[str] = None
    limit_5h_used_percent: Optional[float] = None
    limit_5h_window_minutes: Optional[int] = None
    limit_5h_resets_at_seconds: Optional[int] = None
    limit_weekly_used_percent: Optional[float] = None
    limit_weekly_window_minutes: Optional[int] = None
    limit_weekly_resets_at_seconds: Optional[int] = None
    rate_limit_has_credits: Optional[bool] = None
    rate_limit_unlimited: Optional[bool] = None
    rate_limit_balance: Optional[str] = None
    rate_limit_plan_type: Optional[str] = None
    model: Optional[str] = None
    directory: Optional[str] = None
    session_id: Optional[str] = None
    codex_version: Optional[str] = None
    source: Optional[str] = None


@dataclass
class SessionMeta:
    session_id: str
    session_timestamp: Optional[str]
    session_timestamp_utc: Optional[str]
    cwd: Optional[str]
    originator: Optional[str]
    cli_version: Optional[str]
    source: Optional[str]
    model_provider: Optional[str]
    git_commit_hash: Optional[str]
    git_branch: Optional[str]
    git_repository_url: Optional[str]
    captured_at: Optional[str]
    captured_at_utc: Optional[str]
    rollout_source: Optional[str]


@dataclass
class TurnContext:
    captured_at: str
    captured_at_utc: str
    session_id: Optional[str]
    turn_index: int
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
    source: Optional[str]


@dataclass
class ActivityEvent:
    captured_at: str
    captured_at_utc: str
    event_type: str
    event_name: Optional[str] = None
    count: int = 1
    session_id: Optional[str] = None
    turn_index: Optional[int] = None
    source: Optional[str] = None


@dataclass
class AppTurnMetric:
    thread_id: Optional[str]
    turn_id: Optional[str]
    status: Optional[str]
    started_at: Optional[str]
    completed_at: Optional[str]
    duration_ms: Optional[int]
    source: Optional[str]


@dataclass
class AppItemMetric:
    thread_id: Optional[str]
    turn_id: Optional[str]
    item_id: Optional[str]
    item_type: Optional[str]
    status: Optional[str]
    started_at: Optional[str]
    completed_at: Optional[str]
    duration_ms: Optional[int]
    command_name: Optional[str]
    exit_code: Optional[int]
    output_bytes: Optional[int]
    tool_name: Optional[str]
    web_search_action: Optional[str]
    source: Optional[str]


@dataclass
class MessageEvent:
    captured_at: str
    captured_at_utc: str
    role: str
    message_type: str
    message: str
    session_id: Optional[str] = None
    turn_index: Optional[int] = None
    source: Optional[str] = None


@dataclass
class ToolCallEvent:
    captured_at: str
    captured_at_utc: str
    tool_type: str
    tool_name: Optional[str]
    call_id: Optional[str]
    status: Optional[str]
    input_text: Optional[str]
    output_text: Optional[str]
    command: Optional[str]
    session_id: Optional[str] = None
    turn_index: Optional[int] = None
    source: Optional[str] = None


class UsageStore:
    def __init__(self, path: Path):
        self.path = path
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self.conn = sqlite3.connect(self.path)
        self.conn.row_factory = sqlite3.Row
        self.conn.execute("PRAGMA journal_mode=WAL")
        self.conn.execute("PRAGMA synchronous=NORMAL")
        self.conn.execute("PRAGMA temp_store=MEMORY")
        self._init_schema()

    def close(self) -> None:
        self.conn.close()

    @contextmanager
    def transaction(self):
        try:
            self.conn.execute("BEGIN")
            yield
        except Exception:
            self.conn.rollback()
            raise
        else:
            self.conn.commit()

    def _init_schema(self) -> None:
        cur = self.conn.cursor()
        cur.execute(
            """
            CREATE TABLE IF NOT EXISTS meta (
                key TEXT PRIMARY KEY,
                value TEXT NOT NULL
            )
            """
        )
        cur.execute(
            """
            CREATE TABLE IF NOT EXISTS ingestion_files (
                path TEXT PRIMARY KEY,
                mtime_ns INTEGER NOT NULL,
                size INTEGER NOT NULL,
                last_ingested_at TEXT NOT NULL
            )
            """
        )
        cur.execute(
            """
            CREATE TABLE IF NOT EXISTS events (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                captured_at TEXT NOT NULL,
                captured_at_utc TEXT NOT NULL,
                event_type TEXT NOT NULL,
                total_tokens INTEGER,
                input_tokens INTEGER,
                cached_input_tokens INTEGER,
                output_tokens INTEGER,
                reasoning_output_tokens INTEGER,
                lifetime_total_tokens INTEGER,
                lifetime_input_tokens INTEGER,
                lifetime_cached_input_tokens INTEGER,
                lifetime_output_tokens INTEGER,
                lifetime_reasoning_output_tokens INTEGER,
                context_used INTEGER,
                context_total INTEGER,
                context_percent_left REAL,
                limit_5h_percent_left REAL,
                limit_5h_resets_at TEXT,
                limit_weekly_percent_left REAL,
                limit_weekly_resets_at TEXT,
                limit_5h_used_percent REAL,
                limit_5h_window_minutes INTEGER,
                limit_5h_resets_at_seconds INTEGER,
                limit_weekly_used_percent REAL,
                limit_weekly_window_minutes INTEGER,
                limit_weekly_resets_at_seconds INTEGER,
                rate_limit_has_credits INTEGER,
                rate_limit_unlimited INTEGER,
                rate_limit_balance TEXT,
                rate_limit_plan_type TEXT,
                model TEXT,
                directory TEXT,
                session_id TEXT,
                codex_version TEXT,
                source TEXT
            )
            """
        )
        cur.execute(
            """
            CREATE TABLE IF NOT EXISTS sessions (
                session_id TEXT PRIMARY KEY,
                session_timestamp TEXT,
                session_timestamp_utc TEXT,
                cwd TEXT,
                originator TEXT,
                cli_version TEXT,
                source TEXT,
                model_provider TEXT,
                git_commit_hash TEXT,
                git_branch TEXT,
                git_repository_url TEXT,
                captured_at TEXT,
                captured_at_utc TEXT,
                rollout_source TEXT
            )
            """
        )
        cur.execute(
            """
            CREATE TABLE IF NOT EXISTS session_annotations (
                session_id TEXT PRIMARY KEY,
                note TEXT,
                updated_at TEXT
            )
            """
        )
        cur.execute(
            """
            CREATE TABLE IF NOT EXISTS session_tags (
                session_id TEXT NOT NULL,
                tag TEXT NOT NULL,
                updated_at TEXT,
                PRIMARY KEY (session_id, tag)
            )
            """
        )
        cur.execute(
            """
            CREATE INDEX IF NOT EXISTS session_tags_session_idx
            ON session_tags(session_id)
            """
        )
        cur.execute(
            """
            CREATE INDEX IF NOT EXISTS session_tags_tag_idx
            ON session_tags(tag)
            """
        )
        cur.execute(
            """
            CREATE TABLE IF NOT EXISTS turns (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                session_id TEXT,
                turn_index INTEGER,
                captured_at TEXT NOT NULL,
                captured_at_utc TEXT NOT NULL,
                model TEXT,
                cwd TEXT,
                approval_policy TEXT,
                sandbox_policy_type TEXT,
                sandbox_network_access INTEGER,
                sandbox_writable_roots TEXT,
                sandbox_exclude_tmpdir_env_var INTEGER,
                sandbox_exclude_slash_tmp INTEGER,
                truncation_policy_mode TEXT,
                truncation_policy_limit INTEGER,
                reasoning_effort TEXT,
                reasoning_summary TEXT,
                has_base_instructions INTEGER,
                has_user_instructions INTEGER,
                has_developer_instructions INTEGER,
                has_final_output_json_schema INTEGER,
                source TEXT
            )
            """
        )
        cur.execute(
            """
            CREATE TABLE IF NOT EXISTS activity_events (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                captured_at TEXT NOT NULL,
                captured_at_utc TEXT NOT NULL,
                event_type TEXT NOT NULL,
                event_name TEXT,
                count INTEGER NOT NULL,
                session_id TEXT,
                turn_index INTEGER,
                source TEXT
            )
            """
        )
        cur.execute(
            """
            CREATE TABLE IF NOT EXISTS app_turns (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                thread_id TEXT,
                turn_id TEXT,
                status TEXT,
                started_at TEXT,
                completed_at TEXT,
                duration_ms INTEGER,
                source TEXT
            )
            """
        )
        cur.execute(
            """
            CREATE TABLE IF NOT EXISTS app_items (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                thread_id TEXT,
                turn_id TEXT,
                item_id TEXT,
                item_type TEXT,
                status TEXT,
                started_at TEXT,
                completed_at TEXT,
                duration_ms INTEGER,
                command_name TEXT,
                exit_code INTEGER,
                output_bytes INTEGER,
                tool_name TEXT,
                web_search_action TEXT,
                source TEXT
            )
            """
        )
        cur.execute(
            """
            CREATE TABLE IF NOT EXISTS content_messages (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                captured_at TEXT NOT NULL,
                captured_at_utc TEXT NOT NULL,
                role TEXT NOT NULL,
                message_type TEXT NOT NULL,
                message TEXT NOT NULL,
                session_id TEXT,
                turn_index INTEGER,
                source TEXT
            )
            """
        )
        cur.execute(
            """
            CREATE TABLE IF NOT EXISTS tool_calls (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                captured_at TEXT NOT NULL,
                captured_at_utc TEXT NOT NULL,
                tool_type TEXT NOT NULL,
                tool_name TEXT,
                call_id TEXT,
                status TEXT,
                input_text TEXT,
                output_text TEXT,
                command TEXT,
                session_id TEXT,
                turn_index INTEGER,
                source TEXT
            )
            """
        )
        cur.execute(
            """
            CREATE TABLE IF NOT EXISTS weekly_quota_estimates (
                week_start TEXT PRIMARY KEY,
                week_end TEXT NOT NULL,
                quota_tokens INTEGER NOT NULL,
                quota_cost REAL NOT NULL,
                used_percent REAL,
                observed_tokens INTEGER NOT NULL,
                observed_cost REAL NOT NULL,
                computed_at TEXT NOT NULL
            )
            """
        )
        cur.execute(
            """
            CREATE UNIQUE INDEX IF NOT EXISTS events_dedupe_idx
            ON events(
                captured_at,
                event_type,
                total_tokens,
                input_tokens,
                cached_input_tokens,
                output_tokens,
                reasoning_output_tokens,
                session_id,
                source
            )
            """
        )
        cur.execute(
            """
            CREATE INDEX IF NOT EXISTS events_captured_at_idx
            ON events(captured_at)
            """
        )
        cur.execute(
            """
            CREATE INDEX IF NOT EXISTS events_captured_at_utc_idx
            ON events(captured_at_utc)
            """
        )
        cur.execute(
            """
            CREATE INDEX IF NOT EXISTS events_event_type_idx
            ON events(event_type)
            """
        )
        cur.execute(
            """
            CREATE INDEX IF NOT EXISTS events_event_type_captured_at_utc_idx
            ON events(event_type, captured_at_utc)
            """
        )
        cur.execute(
            """
            CREATE INDEX IF NOT EXISTS turns_session_idx
            ON turns(session_id)
            """
        )
        cur.execute(
            """
            CREATE INDEX IF NOT EXISTS turns_captured_at_idx
            ON turns(captured_at)
            """
        )
        cur.execute(
            """
            CREATE INDEX IF NOT EXISTS turns_captured_at_utc_idx
            ON turns(captured_at_utc)
            """
        )
        cur.execute(
            """
            CREATE INDEX IF NOT EXISTS activity_event_type_idx
            ON activity_events(event_type)
            """
        )
        cur.execute(
            """
            CREATE INDEX IF NOT EXISTS activity_session_idx
            ON activity_events(session_id)
            """
        )
        cur.execute(
            """
            CREATE INDEX IF NOT EXISTS activity_captured_at_idx
            ON activity_events(captured_at)
            """
        )
        cur.execute(
            """
            CREATE INDEX IF NOT EXISTS activity_captured_at_utc_idx
            ON activity_events(captured_at_utc)
            """
        )
        cur.execute(
            """
            CREATE INDEX IF NOT EXISTS app_turns_thread_idx
            ON app_turns(thread_id)
            """
        )
        cur.execute(
            """
            CREATE INDEX IF NOT EXISTS app_turns_turn_idx
            ON app_turns(turn_id)
            """
        )
        cur.execute(
            """
            CREATE INDEX IF NOT EXISTS app_items_turn_idx
            ON app_items(turn_id)
            """
        )
        cur.execute(
            """
            CREATE INDEX IF NOT EXISTS app_items_type_idx
            ON app_items(item_type)
            """
        )
        cur.execute(
            """
            CREATE INDEX IF NOT EXISTS content_messages_session_idx
            ON content_messages(session_id)
            """
        )
        cur.execute(
            """
            CREATE INDEX IF NOT EXISTS content_messages_captured_at_idx
            ON content_messages(captured_at)
            """
        )
        cur.execute(
            """
            CREATE INDEX IF NOT EXISTS content_messages_captured_at_utc_idx
            ON content_messages(captured_at_utc)
            """
        )
        cur.execute(
            """
            CREATE INDEX IF NOT EXISTS tool_calls_session_idx
            ON tool_calls(session_id)
            """
        )
        cur.execute(
            """
            CREATE INDEX IF NOT EXISTS tool_calls_type_idx
            ON tool_calls(tool_type)
            """
        )
        cur.execute(
            """
            CREATE INDEX IF NOT EXISTS tool_calls_captured_at_idx
            ON tool_calls(captured_at)
            """
        )
        cur.execute(
            """
            CREATE INDEX IF NOT EXISTS tool_calls_captured_at_utc_idx
            ON tool_calls(captured_at_utc)
            """
        )
        cur.execute(
            """
            INSERT OR IGNORE INTO meta (key, value) VALUES (?, ?)
            """,
            ("schema_version", str(SCHEMA_VERSION)),
        )
        cur.execute(
            """
            INSERT OR IGNORE INTO meta (key, value) VALUES (?, ?)
            """,
            ("ingest_version", str(INGEST_VERSION)),
        )
        self._ensure_event_columns()
        self._ensure_schema_version()
        self.conn.commit()

    def _ensure_event_columns(self) -> None:
        columns = self.conn.execute("PRAGMA table_info(events)").fetchall()
        existing = {row["name"] for row in columns}
        additions = {
            "lifetime_total_tokens": "INTEGER",
            "lifetime_input_tokens": "INTEGER",
            "lifetime_cached_input_tokens": "INTEGER",
            "lifetime_output_tokens": "INTEGER",
            "lifetime_reasoning_output_tokens": "INTEGER",
            "limit_5h_used_percent": "REAL",
            "limit_5h_window_minutes": "INTEGER",
            "limit_5h_resets_at_seconds": "INTEGER",
            "limit_weekly_used_percent": "REAL",
            "limit_weekly_window_minutes": "INTEGER",
            "limit_weekly_resets_at_seconds": "INTEGER",
            "rate_limit_has_credits": "INTEGER",
            "rate_limit_unlimited": "INTEGER",
            "rate_limit_balance": "TEXT",
            "rate_limit_plan_type": "TEXT",
        }
        for column, ddl in additions.items():
            if column not in existing:
                self.conn.execute(
                    f"ALTER TABLE events ADD COLUMN {column} {ddl}"
                )

    def _ensure_schema_version(self) -> None:
        self.conn.execute(
            """
            INSERT INTO meta (key, value)
            VALUES (?, ?)
            ON CONFLICT(key) DO UPDATE SET value = excluded.value
            """,
            ("schema_version", str(SCHEMA_VERSION)),
        )

    def set_meta(self, key: str, value: str) -> None:
        self.conn.execute(
            """
            INSERT INTO meta (key, value)
            VALUES (?, ?)
            ON CONFLICT(key) DO UPDATE SET value = excluded.value
            """,
            (key, value),
        )
        self.conn.commit()

    def upsert_weekly_quota(
        self,
        week_start: str,
        week_end: str,
        quota_tokens: int,
        quota_cost: float,
        used_percent: Optional[float],
        observed_tokens: int,
        observed_cost: float,
        computed_at: str,
    ) -> None:
        cur = self.conn.cursor()
        cur.execute(
            """
            INSERT INTO weekly_quota_estimates (
                week_start,
                week_end,
                quota_tokens,
                quota_cost,
                used_percent,
                observed_tokens,
                observed_cost,
                computed_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(week_start) DO UPDATE SET
                week_end = excluded.week_end,
                quota_tokens = excluded.quota_tokens,
                quota_cost = excluded.quota_cost,
                used_percent = excluded.used_percent,
                observed_tokens = excluded.observed_tokens,
                observed_cost = excluded.observed_cost,
                computed_at = excluded.computed_at
            """,
            (
                week_start,
                week_end,
                quota_tokens,
                quota_cost,
                used_percent,
                observed_tokens,
                observed_cost,
                computed_at,
            ),
        )
        self.conn.commit()

    def latest_weekly_quota(self) -> Optional[sqlite3.Row]:
        cur = self.conn.cursor()
        row = cur.execute(
            """
            SELECT *
            FROM weekly_quota_estimates
            ORDER BY week_end DESC
            LIMIT 1
            """
        ).fetchone()
        return row

    def insert_event(self, event: UsageEvent) -> None:
        cur = self.conn.cursor()
        cur.execute(
            """
            INSERT OR IGNORE INTO events (
                captured_at,
                captured_at_utc,
                event_type,
                total_tokens,
                input_tokens,
                cached_input_tokens,
                output_tokens,
                reasoning_output_tokens,
                lifetime_total_tokens,
                lifetime_input_tokens,
                lifetime_cached_input_tokens,
                lifetime_output_tokens,
                lifetime_reasoning_output_tokens,
                context_used,
                context_total,
                context_percent_left,
                limit_5h_percent_left,
                limit_5h_resets_at,
                limit_weekly_percent_left,
                limit_weekly_resets_at,
                limit_5h_used_percent,
                limit_5h_window_minutes,
                limit_5h_resets_at_seconds,
                limit_weekly_used_percent,
                limit_weekly_window_minutes,
                limit_weekly_resets_at_seconds,
                rate_limit_has_credits,
                rate_limit_unlimited,
                rate_limit_balance,
                rate_limit_plan_type,
                model,
                directory,
                session_id,
                codex_version,
                source
            ) VALUES (
                ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
                ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
            )
            """,
            (
                event.captured_at,
                event.captured_at_utc,
                event.event_type,
                event.total_tokens,
                event.input_tokens,
                event.cached_input_tokens,
                event.output_tokens,
                event.reasoning_output_tokens,
                event.lifetime_total_tokens,
                event.lifetime_input_tokens,
                event.lifetime_cached_input_tokens,
                event.lifetime_output_tokens,
                event.lifetime_reasoning_output_tokens,
                event.context_used,
                event.context_total,
                event.context_percent_left,
                event.limit_5h_percent_left,
                event.limit_5h_resets_at,
                event.limit_weekly_percent_left,
                event.limit_weekly_resets_at,
                event.limit_5h_used_percent,
                event.limit_5h_window_minutes,
                event.limit_5h_resets_at_seconds,
                event.limit_weekly_used_percent,
                event.limit_weekly_window_minutes,
                event.limit_weekly_resets_at_seconds,
                event.rate_limit_has_credits,
                event.rate_limit_unlimited,
                event.rate_limit_balance,
                event.rate_limit_plan_type,
                event.model,
                event.directory,
                event.session_id,
                event.codex_version,
                event.source,
            ),
        )
        self.conn.commit()

    def insert_events_bulk(
        self,
        events: Iterable[UsageEvent],
        commit: bool = True,
    ) -> int:
        batch = list(events)
        if not batch:
            return 0
        cur = self.conn.cursor()
        cur.executemany(
            """
            INSERT OR IGNORE INTO events (
                captured_at,
                captured_at_utc,
                event_type,
                total_tokens,
                input_tokens,
                cached_input_tokens,
                output_tokens,
                reasoning_output_tokens,
                lifetime_total_tokens,
                lifetime_input_tokens,
                lifetime_cached_input_tokens,
                lifetime_output_tokens,
                lifetime_reasoning_output_tokens,
                context_used,
                context_total,
                context_percent_left,
                limit_5h_percent_left,
                limit_5h_resets_at,
                limit_weekly_percent_left,
                limit_weekly_resets_at,
                limit_5h_used_percent,
                limit_5h_window_minutes,
                limit_5h_resets_at_seconds,
                limit_weekly_used_percent,
                limit_weekly_window_minutes,
                limit_weekly_resets_at_seconds,
                rate_limit_has_credits,
                rate_limit_unlimited,
                rate_limit_balance,
                rate_limit_plan_type,
                model,
                directory,
                session_id,
                codex_version,
                source
            ) VALUES (
                ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
                ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
            )
            """,
            [
                (
                    event.captured_at,
                    event.captured_at_utc,
                    event.event_type,
                    event.total_tokens,
                    event.input_tokens,
                    event.cached_input_tokens,
                    event.output_tokens,
                    event.reasoning_output_tokens,
                    event.lifetime_total_tokens,
                    event.lifetime_input_tokens,
                    event.lifetime_cached_input_tokens,
                    event.lifetime_output_tokens,
                    event.lifetime_reasoning_output_tokens,
                    event.context_used,
                    event.context_total,
                    event.context_percent_left,
                    event.limit_5h_percent_left,
                    event.limit_5h_resets_at,
                    event.limit_weekly_percent_left,
                    event.limit_weekly_resets_at,
                    event.limit_5h_used_percent,
                    event.limit_5h_window_minutes,
                    event.limit_5h_resets_at_seconds,
                    event.limit_weekly_used_percent,
                    event.limit_weekly_window_minutes,
                    event.limit_weekly_resets_at_seconds,
                    event.rate_limit_has_credits,
                    event.rate_limit_unlimited,
                    event.rate_limit_balance,
                    event.rate_limit_plan_type,
                    event.model,
                    event.directory,
                    event.session_id,
                    event.codex_version,
                    event.source,
                )
                for event in batch
            ],
        )
        if commit:
            self.conn.commit()
        return len(batch)

    def upsert_session(self, session: SessionMeta, commit: bool = True) -> None:
        self.conn.execute(
            """
            INSERT INTO sessions (
                session_id,
                session_timestamp,
                session_timestamp_utc,
                cwd,
                originator,
                cli_version,
                source,
                model_provider,
                git_commit_hash,
                git_branch,
                git_repository_url,
                captured_at,
                captured_at_utc,
                rollout_source
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(session_id) DO UPDATE SET
                session_timestamp = excluded.session_timestamp,
                session_timestamp_utc = excluded.session_timestamp_utc,
                cwd = excluded.cwd,
                originator = excluded.originator,
                cli_version = excluded.cli_version,
                source = excluded.source,
                model_provider = excluded.model_provider,
                git_commit_hash = excluded.git_commit_hash,
                git_branch = excluded.git_branch,
                git_repository_url = excluded.git_repository_url,
                captured_at = excluded.captured_at,
                captured_at_utc = excluded.captured_at_utc,
                rollout_source = excluded.rollout_source
            """,
            (
                session.session_id,
                session.session_timestamp,
                session.session_timestamp_utc,
                session.cwd,
                session.originator,
                session.cli_version,
                session.source,
                session.model_provider,
                session.git_commit_hash,
                session.git_branch,
                session.git_repository_url,
                session.captured_at,
                session.captured_at_utc,
                session.rollout_source,
            ),
        )
        if commit:
            self.conn.commit()

    def insert_turn(self, turn: TurnContext) -> None:
        self.conn.execute(
            """
            INSERT INTO turns (
                session_id,
                turn_index,
                captured_at,
                captured_at_utc,
                model,
                cwd,
                approval_policy,
                sandbox_policy_type,
                sandbox_network_access,
                sandbox_writable_roots,
                sandbox_exclude_tmpdir_env_var,
                sandbox_exclude_slash_tmp,
                truncation_policy_mode,
                truncation_policy_limit,
                reasoning_effort,
                reasoning_summary,
                has_base_instructions,
                has_user_instructions,
                has_developer_instructions,
                has_final_output_json_schema,
                source
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                turn.session_id,
                turn.turn_index,
                turn.captured_at,
                turn.captured_at_utc,
                turn.model,
                turn.cwd,
                turn.approval_policy,
                turn.sandbox_policy_type,
                1 if turn.sandbox_network_access else 0
                if turn.sandbox_network_access is not None
                else None,
                turn.sandbox_writable_roots,
                1 if turn.sandbox_exclude_tmpdir_env_var else 0
                if turn.sandbox_exclude_tmpdir_env_var is not None
                else None,
                1 if turn.sandbox_exclude_slash_tmp else 0
                if turn.sandbox_exclude_slash_tmp is not None
                else None,
                turn.truncation_policy_mode,
                turn.truncation_policy_limit,
                turn.reasoning_effort,
                turn.reasoning_summary,
                1 if turn.has_base_instructions else 0,
                1 if turn.has_user_instructions else 0,
                1 if turn.has_developer_instructions else 0,
                1 if turn.has_final_output_json_schema else 0,
                turn.source,
            ),
        )
        self.conn.commit()

    def insert_turns_bulk(
        self,
        turns: Iterable[TurnContext],
        commit: bool = True,
    ) -> int:
        batch = list(turns)
        if not batch:
            return 0
        self.conn.executemany(
            """
            INSERT INTO turns (
                session_id,
                turn_index,
                captured_at,
                captured_at_utc,
                model,
                cwd,
                approval_policy,
                sandbox_policy_type,
                sandbox_network_access,
                sandbox_writable_roots,
                sandbox_exclude_tmpdir_env_var,
                sandbox_exclude_slash_tmp,
                truncation_policy_mode,
                truncation_policy_limit,
                reasoning_effort,
                reasoning_summary,
                has_base_instructions,
                has_user_instructions,
                has_developer_instructions,
                has_final_output_json_schema,
                source
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            [
                (
                    turn.session_id,
                    turn.turn_index,
                    turn.captured_at,
                    turn.captured_at_utc,
                    turn.model,
                    turn.cwd,
                    turn.approval_policy,
                    turn.sandbox_policy_type,
                    1 if turn.sandbox_network_access else 0
                    if turn.sandbox_network_access is not None
                    else None,
                    turn.sandbox_writable_roots,
                    1 if turn.sandbox_exclude_tmpdir_env_var else 0
                    if turn.sandbox_exclude_tmpdir_env_var is not None
                    else None,
                    1 if turn.sandbox_exclude_slash_tmp else 0
                    if turn.sandbox_exclude_slash_tmp is not None
                    else None,
                    turn.truncation_policy_mode,
                    turn.truncation_policy_limit,
                    turn.reasoning_effort,
                    turn.reasoning_summary,
                    1 if turn.has_base_instructions else 0,
                    1 if turn.has_user_instructions else 0,
                    1 if turn.has_developer_instructions else 0,
                    1 if turn.has_final_output_json_schema else 0,
                    turn.source,
                )
                for turn in batch
            ],
        )
        if commit:
            self.conn.commit()
        return len(batch)

    def insert_activity_event(self, event: ActivityEvent) -> None:
        self.conn.execute(
            """
            INSERT INTO activity_events (
                captured_at,
                captured_at_utc,
                event_type,
                event_name,
                count,
                session_id,
                turn_index,
                source
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                event.captured_at,
                event.captured_at_utc,
                event.event_type,
                event.event_name,
                event.count,
                event.session_id,
                event.turn_index,
                event.source,
            ),
        )
        self.conn.commit()

    def insert_activity_events_bulk(
        self,
        events: Iterable[ActivityEvent],
        commit: bool = True,
    ) -> int:
        batch = list(events)
        if not batch:
            return 0
        self.conn.executemany(
            """
            INSERT INTO activity_events (
                captured_at,
                captured_at_utc,
                event_type,
                event_name,
                count,
                session_id,
                turn_index,
                source
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            """,
            [
                (
                    event.captured_at,
                    event.captured_at_utc,
                    event.event_type,
                    event.event_name,
                    event.count,
                    event.session_id,
                    event.turn_index,
                    event.source,
                )
                for event in batch
            ],
        )
        if commit:
            self.conn.commit()
        return len(batch)

    def insert_app_turn(self, metric: AppTurnMetric) -> None:
        self.conn.execute(
            """
            INSERT INTO app_turns (
                thread_id,
                turn_id,
                status,
                started_at,
                completed_at,
                duration_ms,
                source
            ) VALUES (?, ?, ?, ?, ?, ?, ?)
            """,
            (
                metric.thread_id,
                metric.turn_id,
                metric.status,
                metric.started_at,
                metric.completed_at,
                metric.duration_ms,
                metric.source,
            ),
        )
        self.conn.commit()

    def insert_app_turns_bulk(self, metrics: Iterable[AppTurnMetric]) -> int:
        batch = list(metrics)
        if not batch:
            return 0
        self.conn.executemany(
            """
            INSERT INTO app_turns (
                thread_id,
                turn_id,
                status,
                started_at,
                completed_at,
                duration_ms,
                source
            ) VALUES (?, ?, ?, ?, ?, ?, ?)
            """,
            [
                (
                    metric.thread_id,
                    metric.turn_id,
                    metric.status,
                    metric.started_at,
                    metric.completed_at,
                    metric.duration_ms,
                    metric.source,
                )
                for metric in batch
            ],
        )
        self.conn.commit()
        return len(batch)

    def insert_app_item(self, metric: AppItemMetric) -> None:
        self.conn.execute(
            """
            INSERT INTO app_items (
                thread_id,
                turn_id,
                item_id,
                item_type,
                status,
                started_at,
                completed_at,
                duration_ms,
                command_name,
                exit_code,
                output_bytes,
                tool_name,
                web_search_action,
                source
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                metric.thread_id,
                metric.turn_id,
                metric.item_id,
                metric.item_type,
                metric.status,
                metric.started_at,
                metric.completed_at,
                metric.duration_ms,
                metric.command_name,
                metric.exit_code,
                metric.output_bytes,
                metric.tool_name,
                metric.web_search_action,
                metric.source,
            ),
        )
        self.conn.commit()

    def insert_app_items_bulk(self, metrics: Iterable[AppItemMetric]) -> int:
        batch = list(metrics)
        if not batch:
            return 0
        self.conn.executemany(
            """
            INSERT INTO app_items (
                thread_id,
                turn_id,
                item_id,
                item_type,
                status,
                started_at,
                completed_at,
                duration_ms,
                command_name,
                exit_code,
                output_bytes,
                tool_name,
                web_search_action,
                source
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            [
                (
                    metric.thread_id,
                    metric.turn_id,
                    metric.item_id,
                    metric.item_type,
                    metric.status,
                    metric.started_at,
                    metric.completed_at,
                    metric.duration_ms,
                    metric.command_name,
                    metric.exit_code,
                    metric.output_bytes,
                    metric.tool_name,
                    metric.web_search_action,
                    metric.source,
                )
                for metric in batch
            ],
        )
        self.conn.commit()
        return len(batch)

    def insert_message(self, event: MessageEvent) -> None:
        self.conn.execute(
            """
            INSERT INTO content_messages (
                captured_at,
                captured_at_utc,
                role,
                message_type,
                message,
                session_id,
                turn_index,
                source
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                event.captured_at,
                event.captured_at_utc,
                event.role,
                event.message_type,
                event.message,
                event.session_id,
                event.turn_index,
                event.source,
            ),
        )
        self.conn.commit()

    def insert_messages_bulk(
        self,
        events: Iterable[MessageEvent],
        commit: bool = True,
    ) -> int:
        batch = list(events)
        if not batch:
            return 0
        self.conn.executemany(
            """
            INSERT INTO content_messages (
                captured_at,
                captured_at_utc,
                role,
                message_type,
                message,
                session_id,
                turn_index,
                source
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            """,
            [
                (
                    event.captured_at,
                    event.captured_at_utc,
                    event.role,
                    event.message_type,
                    event.message,
                    event.session_id,
                    event.turn_index,
                    event.source,
                )
                for event in batch
            ],
        )
        if commit:
            self.conn.commit()
        return len(batch)

    def insert_tool_call(self, event: ToolCallEvent) -> None:
        self.conn.execute(
            """
            INSERT INTO tool_calls (
                captured_at,
                captured_at_utc,
                tool_type,
                tool_name,
                call_id,
                status,
                input_text,
                output_text,
                command,
                session_id,
                turn_index,
                source
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                event.captured_at,
                event.captured_at_utc,
                event.tool_type,
                event.tool_name,
                event.call_id,
                event.status,
                event.input_text,
                event.output_text,
                event.command,
                event.session_id,
                event.turn_index,
                event.source,
            ),
        )
        self.conn.commit()

    def insert_tool_calls_bulk(
        self,
        events: Iterable[ToolCallEvent],
        commit: bool = True,
    ) -> int:
        batch = list(events)
        if not batch:
            return 0
        self.conn.executemany(
            """
            INSERT INTO tool_calls (
                captured_at,
                captured_at_utc,
                tool_type,
                tool_name,
                call_id,
                status,
                input_text,
                output_text,
                command,
                session_id,
                turn_index,
                source
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            [
                (
                    event.captured_at,
                    event.captured_at_utc,
                    event.tool_type,
                    event.tool_name,
                    event.call_id,
                    event.status,
                    event.input_text,
                    event.output_text,
                    event.command,
                    event.session_id,
                    event.turn_index,
                    event.source,
                )
                for event in batch
            ],
        )
        if commit:
            self.conn.commit()
        return len(batch)

    def iter_events(
        self,
        event_type: Optional[str] = None,
        start: Optional[str] = None,
        end: Optional[str] = None,
    ) -> Iterable[sqlite3.Row]:
        clauses = []
        params = []
        if event_type:
            clauses.append("event_type = ?")
            params.append(event_type)
        if start:
            clauses.append("captured_at >= ?")
            params.append(start)
        if end:
            clauses.append("captured_at <= ?")
            params.append(end)
        where = ""
        if clauses:
            where = " WHERE " + " AND ".join(clauses)
        query = f"SELECT * FROM events{where} ORDER BY captured_at"
        cur = self.conn.execute(query, params)
        return cur.fetchall()

    def latest_status(self) -> Optional[sqlite3.Row]:
        cur = self.conn.execute(
            """
            SELECT * FROM events
            WHERE event_type IN ('status_snapshot', 'token_count')
            ORDER BY captured_at DESC
            LIMIT 1
            """
        )
        return cur.fetchone()

    def ensure_ingest_version(self) -> None:
        cur = self.conn.execute("SELECT value FROM meta WHERE key = ?", ("ingest_version",))
        row = cur.fetchone()
        current = row["value"] if row else None
        if current == str(INGEST_VERSION):
            return
        self.conn.execute("DELETE FROM ingestion_files")
        self.conn.execute(
            """
            INSERT INTO meta (key, value)
            VALUES (?, ?)
            ON CONFLICT(key) DO UPDATE SET value = excluded.value
            """,
            ("ingest_version", str(INGEST_VERSION)),
        )
        self.conn.commit()

    def file_needs_ingest(self, path: str, mtime_ns: int, size: int) -> bool:
        cur = self.conn.execute(
            "SELECT mtime_ns, size FROM ingestion_files WHERE path = ?",
            (path,),
        )
        row = cur.fetchone()
        if row is None:
            return True
        return row["mtime_ns"] != mtime_ns or row["size"] != size

    def mark_file_ingested(
        self,
        path: str,
        mtime_ns: int,
        size: int,
        commit: bool = True,
    ) -> None:
        now = datetime.now().isoformat()
        self.conn.execute(
            """
            INSERT INTO ingestion_files (path, mtime_ns, size, last_ingested_at)
            VALUES (?, ?, ?, ?)
            ON CONFLICT(path) DO UPDATE SET
                mtime_ns = excluded.mtime_ns,
                size = excluded.size,
                last_ingested_at = excluded.last_ingested_at
            """,
            (path, mtime_ns, size, now),
        )
        if commit:
            self.conn.commit()

    def delete_events_for_source(self, source: str, commit: bool = True) -> None:
        self.conn.execute("DELETE FROM events WHERE source = ?", (source,))
        if commit:
            self.conn.commit()

    def delete_turns_for_source(self, source: str, commit: bool = True) -> None:
        self.conn.execute("DELETE FROM turns WHERE source = ?", (source,))
        if commit:
            self.conn.commit()

    def delete_activity_events_for_source(self, source: str, commit: bool = True) -> None:
        self.conn.execute("DELETE FROM activity_events WHERE source = ?", (source,))
        if commit:
            self.conn.commit()

    def delete_app_server_events_for_source(self, source: str, commit: bool = True) -> None:
        self.conn.execute("DELETE FROM app_turns WHERE source = ?", (source,))
        self.conn.execute("DELETE FROM app_items WHERE source = ?", (source,))
        if commit:
            self.conn.commit()

    def delete_content_for_source(self, source: str, commit: bool = True) -> None:
        self.conn.execute("DELETE FROM content_messages WHERE source = ?", (source,))
        self.conn.execute("DELETE FROM tool_calls WHERE source = ?", (source,))
        if commit:
            self.conn.commit()

    def purge_content(self, commit: bool = True) -> tuple[int, int]:
        cur = self.conn.cursor()
        messages = cur.execute(
            "SELECT COUNT(*) AS count FROM content_messages"
        ).fetchone()["count"]
        tool_calls = cur.execute(
            "SELECT COUNT(*) AS count FROM tool_calls"
        ).fetchone()["count"]
        self.conn.execute("DELETE FROM content_messages")
        self.conn.execute("DELETE FROM tool_calls")
        if commit:
            self.conn.commit()
        return int(messages or 0), int(tool_calls or 0)
