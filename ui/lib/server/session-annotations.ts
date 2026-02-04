import { getDb } from "@/lib/server/db";

type DbInstance = ReturnType<typeof getDb>;

export const ensureSessionAnnotationTables = (db: DbInstance) => {
  db.prepare(
    `
    CREATE TABLE IF NOT EXISTS session_annotations (
      session_id TEXT PRIMARY KEY,
      note TEXT,
      updated_at TEXT
    )
    `
  ).run();

  db.prepare(
    `
    CREATE TABLE IF NOT EXISTS session_tags (
      session_id TEXT NOT NULL,
      tag TEXT NOT NULL,
      updated_at TEXT,
      PRIMARY KEY (session_id, tag)
    )
    `
  ).run();

  db.prepare(
    `
    CREATE INDEX IF NOT EXISTS session_tags_session_idx
    ON session_tags(session_id)
    `
  ).run();

  db.prepare(
    `
    CREATE INDEX IF NOT EXISTS session_tags_tag_idx
    ON session_tags(tag)
    `
  ).run();
};
