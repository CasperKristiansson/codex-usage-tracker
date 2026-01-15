import sqlite3
from datetime import datetime
from dataclasses import dataclass
from pathlib import Path
from typing import Iterable, Optional

SCHEMA_VERSION = 1


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
    context_used: Optional[int] = None
    context_total: Optional[int] = None
    context_percent_left: Optional[float] = None
    limit_5h_percent_left: Optional[float] = None
    limit_5h_resets_at: Optional[str] = None
    limit_weekly_percent_left: Optional[float] = None
    limit_weekly_resets_at: Optional[str] = None
    model: Optional[str] = None
    directory: Optional[str] = None
    session_id: Optional[str] = None
    codex_version: Optional[str] = None
    source: Optional[str] = None


class UsageStore:
    def __init__(self, path: Path):
        self.path = path
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self.conn = sqlite3.connect(self.path)
        self.conn.row_factory = sqlite3.Row
        self._init_schema()

    def close(self) -> None:
        self.conn.close()

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
                context_used INTEGER,
                context_total INTEGER,
                context_percent_left REAL,
                limit_5h_percent_left REAL,
                limit_5h_resets_at TEXT,
                limit_weekly_percent_left REAL,
                limit_weekly_resets_at TEXT,
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
            CREATE INDEX IF NOT EXISTS events_event_type_idx
            ON events(event_type)
            """
        )
        cur.execute(
            """
            INSERT OR IGNORE INTO meta (key, value) VALUES (?, ?)
            """,
            ("schema_version", str(SCHEMA_VERSION)),
        )
        self.conn.commit()

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
                context_used,
                context_total,
                context_percent_left,
                limit_5h_percent_left,
                limit_5h_resets_at,
                limit_weekly_percent_left,
                limit_weekly_resets_at,
                model,
                directory,
                session_id,
                codex_version,
                source
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
                event.context_used,
                event.context_total,
                event.context_percent_left,
                event.limit_5h_percent_left,
                event.limit_5h_resets_at,
                event.limit_weekly_percent_left,
                event.limit_weekly_resets_at,
                event.model,
                event.directory,
                event.session_id,
                event.codex_version,
                event.source,
            ),
        )
        self.conn.commit()

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

    def file_needs_ingest(self, path: str, mtime_ns: int, size: int) -> bool:
        cur = self.conn.execute(
            "SELECT mtime_ns, size FROM ingestion_files WHERE path = ?",
            (path,),
        )
        row = cur.fetchone()
        if row is None:
            return True
        return row["mtime_ns"] != mtime_ns or row["size"] != size

    def mark_file_ingested(self, path: str, mtime_ns: int, size: int) -> None:
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
        self.conn.commit()
