import sqlite3
from contextlib import contextmanager
from datetime import datetime
from dataclasses import dataclass
from pathlib import Path
from typing import Iterable, Optional

SCHEMA_VERSION = 8
INGEST_VERSION = 5
STORAGE_PROFILE_VERSION = 3
TOOL_PAYLOAD_PROFILE_VERSION = 1

LEAN_ACTIVITY_EVENT_TYPES = (
    "assistant_message",
    "shell_command",
    "tool_call",
    "tool_name",
    "user_message",
)
LEAN_TOOL_OUTPUT_TYPES = (
    "custom_tool_call_output",
    "function_call_output",
)
REDUNDANT_ACTIVITY_INDEXES = (
    "activity_event_type_idx",
    "activity_session_idx",
    "activity_captured_at_idx",
    "activity_captured_at_utc_idx",
)
REDUNDANT_TOOL_CALL_INDEXES = (
    "tool_calls_captured_at_utc_idx",
)
REDUNDANT_LOCAL_TIME_INDEXES = (
    "events_captured_at_idx",
    "turns_captured_at_idx",
    "tool_calls_captured_at_idx",
    "content_messages_captured_at_idx",
)
REDUNDANT_SOURCE_TEXT_INDEXES = (
    "events_source_idx",
    "turns_source_idx",
    "activity_events_source_idx",
    "app_turns_source_idx",
    "app_items_source_idx",
    "tool_calls_source_idx",
    "messages_source_idx",
)
SOURCE_TABLES = (
    "events",
    "turns",
    "activity_events",
    "app_turns",
    "app_items",
    "messages",
    "tool_calls",
)
BULK_LOAD_INDEX_DDL = {
    "events_captured_at_utc_idx": "CREATE INDEX IF NOT EXISTS events_captured_at_utc_idx ON events(captured_at_utc)",
    "events_event_type_idx": "CREATE INDEX IF NOT EXISTS events_event_type_idx ON events(event_type)",
    "events_event_type_captured_at_utc_idx": (
        "CREATE INDEX IF NOT EXISTS events_event_type_captured_at_utc_idx "
        "ON events(event_type, captured_at_utc)"
    ),
    "turns_session_idx": "CREATE INDEX IF NOT EXISTS turns_session_idx ON turns(session_id)",
    "turns_captured_at_utc_idx": "CREATE INDEX IF NOT EXISTS turns_captured_at_utc_idx ON turns(captured_at_utc)",
    "turns_captured_at_utc_desc_idx": (
        "CREATE INDEX IF NOT EXISTS turns_captured_at_utc_desc_idx "
        "ON turns(captured_at_utc DESC)"
    ),
    "app_turns_thread_idx": "CREATE INDEX IF NOT EXISTS app_turns_thread_idx ON app_turns(thread_id)",
    "app_turns_turn_idx": "CREATE INDEX IF NOT EXISTS app_turns_turn_idx ON app_turns(turn_id)",
    "app_items_turn_idx": "CREATE INDEX IF NOT EXISTS app_items_turn_idx ON app_items(turn_id)",
    "app_items_type_idx": "CREATE INDEX IF NOT EXISTS app_items_type_idx ON app_items(item_type)",
    "messages_session_idx": "CREATE INDEX IF NOT EXISTS messages_session_idx ON messages(session_id)",
    "messages_captured_at_utc_idx": "CREATE INDEX IF NOT EXISTS messages_captured_at_utc_idx ON messages(captured_at_utc)",
    "messages_session_ordinal_idx": (
        "CREATE INDEX IF NOT EXISTS messages_session_ordinal_idx "
        "ON messages(session_id, ordinal)"
    ),
    "messages_session_turn_idx": (
        "CREATE INDEX IF NOT EXISTS messages_session_turn_idx "
        "ON messages(session_id, turn_index, captured_at_utc)"
    ),
    "tool_calls_captured_at_utc_desc_idx": (
        "CREATE INDEX IF NOT EXISTS tool_calls_captured_at_utc_desc_idx "
        "ON tool_calls(captured_at_utc DESC)"
    ),
    "events_type_utc_session_idx": (
        "CREATE INDEX IF NOT EXISTS events_type_utc_session_idx "
        "ON events(event_type, captured_at_utc, session_id)"
    ),
    "tool_calls_session_idx": "CREATE INDEX IF NOT EXISTS tool_calls_session_idx ON tool_calls(session_id)",
    "tool_calls_type_idx": "CREATE INDEX IF NOT EXISTS tool_calls_type_idx ON tool_calls(tool_type)",
}
BULK_LOAD_SOURCE_INDEX_DDL = {
    f"{table}_source_id_idx": f"CREATE INDEX IF NOT EXISTS {table}_source_id_idx ON {table}(source_id)"
    for table in SOURCE_TABLES
}
BULK_LOAD_INDEX_DDL.update(BULK_LOAD_SOURCE_INDEX_DDL)


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
    ordinal: Optional[int] = None
    source_line: Optional[int] = None


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
    input_length: Optional[int] = None
    output_length: Optional[int] = None
    payload_truncated: bool = False


class UsageStore:
    def __init__(self, path: Path):
        self.path = path
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self.conn = sqlite3.connect(self.path, timeout=30.0)
        self.conn.row_factory = sqlite3.Row
        self._source_id_cache: dict[str, int] = {}
        self.conn.execute("PRAGMA busy_timeout=30000")
        self.conn.execute("PRAGMA journal_mode=WAL")
        self.conn.execute("PRAGMA synchronous=NORMAL")
        self.conn.execute("PRAGMA temp_store=MEMORY")
        self._init_schema()
        self._ensure_storage_profile()

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
                last_ingested_at TEXT NOT NULL,
                content_hash TEXT
            )
            """
        )
        cur.execute(
            """
            CREATE TABLE IF NOT EXISTS sources (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                path TEXT NOT NULL UNIQUE
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
                source TEXT,
                source_id INTEGER
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
                source TEXT,
                source_id INTEGER
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
                source TEXT,
                source_id INTEGER
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
                source TEXT,
                source_id INTEGER
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
                source TEXT,
                source_id INTEGER
            )
            """
        )
        cur.execute(
            """
            CREATE TABLE IF NOT EXISTS messages (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                captured_at TEXT NOT NULL,
                captured_at_utc TEXT NOT NULL,
                role TEXT NOT NULL,
                message_type TEXT NOT NULL,
                content TEXT NOT NULL,
                content_length INTEGER NOT NULL DEFAULT 0,
                session_id TEXT,
                turn_index INTEGER,
                ordinal INTEGER,
                source TEXT,
                source_id INTEGER,
                source_line INTEGER
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
                input_length INTEGER,
                output_length INTEGER,
                payload_truncated INTEGER NOT NULL DEFAULT 0,
                session_id TEXT,
                turn_index INTEGER,
                source TEXT,
                source_id INTEGER
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
            CREATE INDEX IF NOT EXISTS turns_captured_at_utc_idx
            ON turns(captured_at_utc)
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
            CREATE INDEX IF NOT EXISTS messages_session_idx
            ON messages(session_id)
            """
        )
        cur.execute(
            """
            CREATE INDEX IF NOT EXISTS messages_captured_at_utc_idx
            ON messages(captured_at_utc)
            """
        )
        cur.execute(
            """
            CREATE INDEX IF NOT EXISTS messages_session_ordinal_idx
            ON messages(session_id, ordinal)
            """
        )
        cur.execute(
            """
            CREATE INDEX IF NOT EXISTS messages_session_turn_idx
            ON messages(session_id, turn_index, captured_at_utc)
            """
        )
        cur.execute(
            """
            CREATE INDEX IF NOT EXISTS turns_captured_at_utc_desc_idx
            ON turns(captured_at_utc DESC)
            """
        )
        cur.execute(
            """
            CREATE INDEX IF NOT EXISTS tool_calls_captured_at_utc_desc_idx
            ON tool_calls(captured_at_utc DESC)
            """
        )
        cur.execute(
            """
            CREATE INDEX IF NOT EXISTS events_type_utc_session_idx
            ON events(event_type, captured_at_utc, session_id)
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
        self._ensure_ingestion_columns()
        self._ensure_message_columns()
        self._ensure_tool_call_columns()
        self._ensure_source_columns()
        self._ensure_content_messages_view()
        self._backfill_source_ids()
        self._ensure_source_indexes()
        self._ensure_messages_fts()
        self._ensure_schema_version()
        self.conn.commit()

    def _ensure_ingestion_columns(self) -> None:
        columns = self.conn.execute("PRAGMA table_info(ingestion_files)").fetchall()
        existing = {row["name"] for row in columns}
        additions = {
            "content_hash": "TEXT",
        }
        for column, ddl in additions.items():
            if column not in existing:
                self.conn.execute(
                    f"ALTER TABLE ingestion_files ADD COLUMN {column} {ddl}"
                )

    def _ensure_message_columns(self) -> None:
        columns = self.conn.execute("PRAGMA table_info(messages)").fetchall()
        existing = {row["name"] for row in columns}
        additions = {
            "content_length": "INTEGER NOT NULL DEFAULT 0",
            "ordinal": "INTEGER",
            "source_id": "INTEGER",
            "source_line": "INTEGER",
        }
        for column, ddl in additions.items():
            if column not in existing:
                self.conn.execute(
                    f"ALTER TABLE messages ADD COLUMN {column} {ddl}"
                )
        missing_lengths = self.conn.execute(
            """
            SELECT 1
            FROM messages
            WHERE content_length IS NULL
               OR (content_length = 0 AND length(content) != 0)
            LIMIT 1
            """
        ).fetchone()
        if missing_lengths:
            self.conn.execute(
                """
                UPDATE messages
                SET content_length = length(content)
                WHERE content_length IS NULL
                   OR (content_length = 0 AND length(content) != 0)
                """
            )

    def _ensure_tool_call_columns(self) -> None:
        columns = self.conn.execute("PRAGMA table_info(tool_calls)").fetchall()
        existing = {row["name"] for row in columns}
        additions = {
            "input_length": "INTEGER",
            "output_length": "INTEGER",
            "payload_truncated": "INTEGER NOT NULL DEFAULT 0",
        }
        for column, ddl in additions.items():
            if column not in existing:
                self.conn.execute(
                    f"ALTER TABLE tool_calls ADD COLUMN {column} {ddl}"
                )
        missing_input_lengths = self.conn.execute(
            """
            SELECT 1
            FROM tool_calls
            WHERE input_length IS NULL AND input_text IS NOT NULL
            LIMIT 1
            """
        ).fetchone()
        if missing_input_lengths:
            self.conn.execute(
                """
                UPDATE tool_calls
                SET input_length = length(input_text)
                WHERE input_length IS NULL AND input_text IS NOT NULL
                """
            )
        missing_output_lengths = self.conn.execute(
            """
            SELECT 1
            FROM tool_calls
            WHERE output_length IS NULL AND output_text IS NOT NULL
            LIMIT 1
            """
        ).fetchone()
        if missing_output_lengths:
            self.conn.execute(
                """
                UPDATE tool_calls
                SET output_length = length(output_text)
                WHERE output_length IS NULL AND output_text IS NOT NULL
                """
            )

    def _ensure_source_columns(self) -> None:
        for table in SOURCE_TABLES:
            columns = self.conn.execute(f"PRAGMA table_info({table})").fetchall()
            existing = {row["name"] for row in columns}
            if "source_id" not in existing:
                self.conn.execute(f"ALTER TABLE {table} ADD COLUMN source_id INTEGER")

    def _backfill_source_ids(self) -> None:
        for table in SOURCE_TABLES:
            missing = self.conn.execute(
                f"""
                SELECT 1
                FROM {table}
                WHERE source_id IS NULL
                  AND source IS NOT NULL
                  AND source != ''
                LIMIT 1
                """
            ).fetchone()
            if not missing:
                continue
            self.conn.execute(
                f"""
                INSERT OR IGNORE INTO sources(path)
                SELECT DISTINCT source
                FROM {table}
                WHERE source IS NOT NULL AND source != ''
                """
            )
            self.conn.execute(
                f"""
                UPDATE {table}
                SET source_id = (
                    SELECT id
                    FROM sources
                    WHERE sources.path = {table}.source
                )
                WHERE source_id IS NULL
                  AND source IS NOT NULL
                  AND source != ''
                """
            )
        self._source_id_cache.clear()

    def _ensure_source_indexes(self) -> None:
        for table in SOURCE_TABLES:
            self.conn.execute(
                f"CREATE INDEX IF NOT EXISTS {table}_source_id_idx ON {table}(source_id)"
            )

    def _ensure_messages_fts(self) -> None:
        try:
            row = self.conn.execute(
                """
                SELECT name
                FROM sqlite_master
                WHERE type = 'table' AND name = 'messages_fts'
                """
            ).fetchone()
            had_fts = row is not None
            if had_fts:
                trigger_count = self.conn.execute(
                    """
                    SELECT COUNT(*) AS count
                    FROM sqlite_master
                    WHERE type = 'trigger'
                      AND name IN ('messages_ai', 'messages_ad', 'messages_au')
                    """
                ).fetchone()["count"]
                if int(trigger_count or 0) == 3:
                    return
            self.conn.executescript(
                """
                CREATE VIRTUAL TABLE IF NOT EXISTS messages_fts USING fts5(
                    content,
                    content='messages',
                    content_rowid='id',
                    tokenize='porter unicode61'
                );

                CREATE TRIGGER IF NOT EXISTS messages_ai AFTER INSERT ON messages BEGIN
                    INSERT INTO messages_fts(rowid, content) VALUES (new.id, new.content);
                END;

                CREATE TRIGGER IF NOT EXISTS messages_ad AFTER DELETE ON messages BEGIN
                    INSERT INTO messages_fts(messages_fts, rowid, content)
                    VALUES('delete', old.id, old.content);
                END;

                CREATE TRIGGER IF NOT EXISTS messages_au AFTER UPDATE ON messages BEGIN
                    INSERT INTO messages_fts(messages_fts, rowid, content)
                    VALUES('delete', old.id, old.content);
                    INSERT INTO messages_fts(rowid, content) VALUES (new.id, new.content);
                END;
                """
            )
            if not had_fts:
                self.conn.execute("INSERT INTO messages_fts(messages_fts) VALUES('rebuild')")
        except sqlite3.OperationalError:
            # FTS5 is available in normal Python/SQLite builds, but keeping the
            # core DB usable is more important than failing startup on a minimal
            # SQLite build.
            return

    def drop_messages_fts(self) -> None:
        self.conn.executescript(
            """
            DROP TRIGGER IF EXISTS messages_ai;
            DROP TRIGGER IF EXISTS messages_ad;
            DROP TRIGGER IF EXISTS messages_au;
            DROP TABLE IF EXISTS messages_fts;
            """
        )

    def rebuild_messages_fts(self) -> None:
        self.drop_messages_fts()
        self._ensure_messages_fts()

    def drop_bulk_load_indexes(self) -> None:
        for index_name in BULK_LOAD_INDEX_DDL:
            self._drop_index_if_exists(index_name)

    def recreate_bulk_load_indexes(self) -> None:
        for ddl in BULK_LOAD_INDEX_DDL.values():
            self.conn.execute(ddl)

    def prepare_bulk_load(self, include_messages: bool) -> None:
        if include_messages:
            self.drop_messages_fts()
        self.drop_bulk_load_indexes()
        self.conn.commit()

    def finish_bulk_load(self, include_messages: bool) -> None:
        self._backfill_source_ids()
        self.recreate_bulk_load_indexes()
        if include_messages:
            self.rebuild_messages_fts()
        self.conn.commit()

    def _ensure_content_messages_view(self) -> None:
        row = self.conn.execute(
            """
            SELECT type
            FROM sqlite_master
            WHERE name = 'content_messages'
              AND type IN ('table', 'view')
            """
        ).fetchone()
        if row and row["type"] == "table":
            legacy_columns = self.conn.execute(
                "PRAGMA table_info(content_messages)"
            ).fetchall()
            legacy_names = {col["name"] for col in legacy_columns}
            if {"captured_at", "captured_at_utc", "role", "message_type", "message"}.issubset(
                legacy_names
            ):
                self.conn.execute(
                    """
                    INSERT INTO messages (
                        captured_at,
                        captured_at_utc,
                        role,
                        message_type,
                        content,
                        content_length,
                        session_id,
                        turn_index,
                        source
                    )
                    SELECT
                        captured_at,
                        captured_at_utc,
                        role,
                        message_type,
                        message,
                        length(message),
                        session_id,
                        turn_index,
                        source
                    FROM content_messages
                    """
                )
            self.conn.execute("DROP TABLE content_messages")
            row = None

        if not row:
            self.conn.execute(
                """
                CREATE VIEW IF NOT EXISTS content_messages AS
                SELECT
                    id,
                    captured_at,
                    captured_at_utc,
                    role,
                    message_type,
                    content AS message,
                    session_id,
                    turn_index,
                    source
                FROM messages
                """
            )

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
        current = self._get_meta("schema_version")
        if current == str(SCHEMA_VERSION):
            return
        self.conn.execute(
            """
            INSERT INTO meta (key, value)
            VALUES (?, ?)
            ON CONFLICT(key) DO UPDATE SET value = excluded.value
            """,
            ("schema_version", str(SCHEMA_VERSION)),
        )

    def _get_meta(self, key: str) -> Optional[str]:
        row = self.conn.execute(
            "SELECT value FROM meta WHERE key = ?",
            (key,),
        ).fetchone()
        return row["value"] if row else None

    def _drop_index_if_exists(self, name: str) -> bool:
        row = self.conn.execute(
            """
            SELECT name
            FROM sqlite_master
            WHERE type = 'index' AND name = ?
            """,
            (name,),
        ).fetchone()
        if row is None:
            return False
        self.conn.execute(f"DROP INDEX IF EXISTS {name}")
        return True

    def _ensure_storage_profile(self) -> None:
        current = self._get_meta("storage_profile_version")
        if current == str(STORAGE_PROFILE_VERSION):
            return

        changed = False
        for index_name in (
            *REDUNDANT_ACTIVITY_INDEXES,
            *REDUNDANT_TOOL_CALL_INDEXES,
            *REDUNDANT_LOCAL_TIME_INDEXES,
            *REDUNDANT_SOURCE_TEXT_INDEXES,
        ):
            changed = self._drop_index_if_exists(index_name) or changed

        tool_outputs_deleted = self.conn.execute(
            f"""
            DELETE FROM tool_calls
            WHERE tool_type IN ({",".join("?" for _ in LEAN_TOOL_OUTPUT_TYPES)})
            """,
            LEAN_TOOL_OUTPUT_TYPES,
        ).rowcount
        tool_rows_redacted = self.conn.execute(
            """
            UPDATE tool_calls
            SET call_id = NULL,
                input_text = NULL,
                output_text = NULL,
                command = NULL
            WHERE call_id IS NOT NULL
               OR input_text IS NOT NULL
               OR output_text IS NOT NULL
               OR command IS NOT NULL
            """
        ).rowcount
        activity_deleted = self.conn.execute(
            f"""
            DELETE FROM activity_events
            WHERE event_type IN ({",".join("?" for _ in LEAN_ACTIVITY_EVENT_TYPES)})
            """,
            LEAN_ACTIVITY_EVENT_TYPES,
        ).rowcount

        changed = any(
            count > 0
            for count in (
                tool_outputs_deleted,
                tool_rows_redacted,
                activity_deleted,
            )
        ) or changed

        self.conn.execute(
            """
            INSERT INTO meta (key, value)
            VALUES (?, ?)
            ON CONFLICT(key) DO UPDATE SET value = excluded.value
            """,
            ("storage_profile_version", str(STORAGE_PROFILE_VERSION)),
        )
        self.conn.commit()
        if changed:
            self.vacuum()

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

    def _source_id(self, source: Optional[str], create: bool = True) -> Optional[int]:
        if not source:
            return None
        cached = self._source_id_cache.get(source)
        if cached is not None:
            return cached
        if create:
            self.conn.execute(
                "INSERT OR IGNORE INTO sources(path) VALUES (?)",
                (source,),
            )
        row = self.conn.execute(
            "SELECT id FROM sources WHERE path = ?",
            (source,),
        ).fetchone()
        if row is None:
            return None
        source_id = int(row["id"])
        self._source_id_cache[source] = source_id
        return source_id

    def _delete_from_table_for_source(self, table: str, source: str) -> None:
        source_id = self._source_id(source, create=False)
        if source_id is not None:
            self.conn.execute(f"DELETE FROM {table} WHERE source_id = ?", (source_id,))
            return
        self.conn.execute(f"DELETE FROM {table} WHERE source = ?", (source,))

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
	                source,
	                source_id
	            ) VALUES (
	                ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
	                ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
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
	                self._source_id(event.source),
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
	                source,
	                source_id
	            ) VALUES (
	                ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
	                ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
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
	                    self._source_id(event.source),
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
	                source,
	                source_id
	            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
	                self._source_id(turn.source),
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
	                source,
	                source_id
	            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
	                    self._source_id(turn.source),
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
	                source,
	                source_id
	            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
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
	                self._source_id(event.source),
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
	                source,
	                source_id
	            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
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
	                    self._source_id(event.source),
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
	                source,
	                source_id
	            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                metric.thread_id,
                metric.turn_id,
                metric.status,
                metric.started_at,
	                metric.completed_at,
	                metric.duration_ms,
	                metric.source,
	                self._source_id(metric.source),
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
	                source,
	                source_id
	            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
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
	                    self._source_id(metric.source),
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
	                source,
	                source_id
	            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
	                self._source_id(metric.source),
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
	                source,
	                source_id
	            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
	                    self._source_id(metric.source),
	                )
                for metric in batch
            ],
        )
        self.conn.commit()
        return len(batch)

    def insert_message(self, event: MessageEvent) -> None:
        self.conn.execute(
            """
            INSERT INTO messages (
                captured_at,
                captured_at_utc,
                role,
                message_type,
                content,
                content_length,
                session_id,
	                turn_index,
	                ordinal,
	                source,
	                source_id,
	                source_line
	            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                event.captured_at,
                event.captured_at_utc,
                event.role,
                event.message_type,
                event.message,
                len(event.message),
                event.session_id,
	                event.turn_index,
	                event.ordinal,
	                event.source,
	                self._source_id(event.source),
	                event.source_line,
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
            INSERT INTO messages (
                captured_at,
                captured_at_utc,
                role,
                message_type,
                content,
                content_length,
                session_id,
	                turn_index,
	                ordinal,
	                source,
	                source_id,
	                source_line
	            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            [
                (
                    event.captured_at,
                    event.captured_at_utc,
                    event.role,
                    event.message_type,
                    event.message,
                    len(event.message),
                    event.session_id,
	                    event.turn_index,
	                    event.ordinal,
	                    event.source,
	                    self._source_id(event.source),
	                    event.source_line,
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
	                input_length,
	                output_length,
	                payload_truncated,
	                session_id,
	                turn_index,
	                source,
	                source_id
	            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
	                event.input_length,
	                event.output_length,
	                1 if event.payload_truncated else 0,
	                event.session_id,
	                event.turn_index,
	                event.source,
	                self._source_id(event.source),
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
	                input_length,
	                output_length,
	                payload_truncated,
	                session_id,
	                turn_index,
	                source,
	                source_id
	            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
	                    event.input_length,
	                    event.output_length,
	                    1 if event.payload_truncated else 0,
	                    event.session_id,
	                    event.turn_index,
	                    event.source,
	                    self._source_id(event.source),
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
            clauses.append("captured_at_utc >= ?")
            params.append(start)
        if end:
            clauses.append("captured_at_utc <= ?")
            params.append(end)
        where = ""
        if clauses:
            where = " WHERE " + " AND ".join(clauses)
        query = f"SELECT * FROM events{where} ORDER BY captured_at_utc"
        cur = self.conn.execute(query, params)
        return cur.fetchall()

    def iter_usage_events(
        self,
        start: Optional[str] = None,
        end: Optional[str] = None,
    ) -> Iterable[sqlite3.Row]:
        clauses = ["event_type IN ('usage_line', 'token_count')"]
        params = []
        if start:
            clauses.append("captured_at_utc >= ?")
            params.append(start)
        if end:
            clauses.append("captured_at_utc <= ?")
            params.append(end)
        where = " WHERE " + " AND ".join(clauses)
        cur = self.conn.execute(
            f"SELECT * FROM events{where} ORDER BY captured_at_utc",
            params,
        )
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
        return self.file_needs_ingest_with_hash(path, mtime_ns, size, None)

    def ingestion_file_count(self) -> int:
        row = self.conn.execute(
            "SELECT COUNT(*) AS count FROM ingestion_files"
        ).fetchone()
        return int(row["count"] or 0)

    def file_needs_ingest_with_hash(
        self, path: str, mtime_ns: int, size: int, content_hash: Optional[str]
    ) -> bool:
        row = self.conn.execute(
            "SELECT mtime_ns, size, content_hash FROM ingestion_files WHERE path = ?",
            (path,),
        ).fetchone()
        if row is None:
            return True
        if row["mtime_ns"] != mtime_ns or row["size"] != size:
            return True
        if content_hash is None:
            return False
        stored_hash = row["content_hash"]
        return stored_hash is not None and stored_hash != content_hash

    def mark_file_ingested(
        self,
        path: str,
        mtime_ns: int,
        size: int,
        content_hash: Optional[str] = None,
        commit: bool = True,
    ) -> None:
        now = datetime.now().isoformat()
        self.conn.execute(
            """
            INSERT INTO ingestion_files (path, mtime_ns, size, last_ingested_at, content_hash)
            VALUES (?, ?, ?, ?, ?)
            ON CONFLICT(path) DO UPDATE SET
                mtime_ns = excluded.mtime_ns,
                size = excluded.size,
                last_ingested_at = excluded.last_ingested_at,
                content_hash = excluded.content_hash
            """,
            (path, mtime_ns, size, now, content_hash),
        )
        if commit:
            self.conn.commit()

    def update_file_hash(
        self,
        path: str,
        mtime_ns: int,
        size: int,
        content_hash: str,
        commit: bool = True,
    ) -> None:
        self.conn.execute(
            """
            UPDATE ingestion_files
            SET content_hash = ?, mtime_ns = ?, size = ?
            WHERE path = ?
            """,
            (content_hash, mtime_ns, size, path),
        )
        if commit:
            self.conn.commit()

    def delete_events_for_source(self, source: str, commit: bool = True) -> None:
        self._delete_from_table_for_source("events", source)
        if commit:
            self.conn.commit()

    def delete_turns_for_source(self, source: str, commit: bool = True) -> None:
        self._delete_from_table_for_source("turns", source)
        if commit:
            self.conn.commit()

    def delete_activity_events_for_source(self, source: str, commit: bool = True) -> None:
        self._delete_from_table_for_source("activity_events", source)
        if commit:
            self.conn.commit()

    def delete_app_server_events_for_source(self, source: str, commit: bool = True) -> None:
        self._delete_from_table_for_source("app_turns", source)
        self._delete_from_table_for_source("app_items", source)
        if commit:
            self.conn.commit()

    def delete_content_for_source(self, source: str, commit: bool = True) -> None:
        self._delete_from_table_for_source("messages", source)
        self._delete_from_table_for_source("tool_calls", source)
        if commit:
            self.conn.commit()

    def purge_content(self, commit: bool = True) -> tuple[int, int]:
        cur = self.conn.cursor()
        messages = cur.execute(
            "SELECT COUNT(*) AS count FROM messages"
        ).fetchone()["count"]
        tool_calls = cur.execute(
            "SELECT COUNT(*) AS count FROM tool_calls"
        ).fetchone()["count"]
        self.conn.execute("DELETE FROM messages")
        self.conn.execute("DELETE FROM tool_calls")
        if commit:
            self.conn.commit()
        return int(messages or 0), int(tool_calls or 0)

    def purge_payloads(self, commit: bool = True) -> tuple[int, int]:
        """
        Delete stored content messages and redact tool call payload fields.

        Keeps tool call metadata (type/name/status/command/session_id/turn_index/timestamps).
        """
        cur = self.conn.cursor()
        messages = cur.execute(
            "SELECT COUNT(*) AS count FROM messages"
        ).fetchone()["count"]
        tool_rows = cur.execute(
            """
            SELECT COUNT(*) AS count
            FROM tool_calls
            WHERE call_id IS NOT NULL
               OR input_text IS NOT NULL
               OR output_text IS NOT NULL
               OR command IS NOT NULL
            """
        ).fetchone()["count"]
        self.conn.execute("DELETE FROM messages")
        self.conn.execute(
            """
            UPDATE tool_calls
            SET call_id = NULL,
                input_text = NULL,
                output_text = NULL,
                command = NULL
            WHERE call_id IS NOT NULL
               OR input_text IS NOT NULL
               OR output_text IS NOT NULL
               OR command IS NOT NULL
            """
        )
        if commit:
            self.conn.commit()
        return int(messages or 0), int(tool_rows or 0)

    def vacuum(self) -> None:
        # VACUUM cannot run inside a transaction.
        previous = self.conn.isolation_level
        self.conn.isolation_level = None
        try:
            self.conn.execute("VACUUM")
        finally:
            self.conn.isolation_level = previous
