import { getDb } from "@/lib/server/db";

type DbInstance = ReturnType<typeof getDb>;

const safeRun = (db: DbInstance, sql: string) => {
  try {
    db.prepare(sql).run();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.toLowerCase().includes("readonly")) {
      return;
    }
    throw error;
  }
};

export const ensureSessionAnnotationTables = (db: DbInstance) => {
  safeRun(
    db,
    `
    CREATE TABLE IF NOT EXISTS session_annotations (
      session_id TEXT PRIMARY KEY,
      note TEXT,
      updated_at TEXT
    )
    `
  );

  safeRun(
    db,
    `
    CREATE TABLE IF NOT EXISTS session_tags (
      session_id TEXT NOT NULL,
      tag TEXT NOT NULL,
      updated_at TEXT,
      PRIMARY KEY (session_id, tag)
    )
    `
  );

  safeRun(
    db,
    `
    CREATE INDEX IF NOT EXISTS session_tags_session_idx
    ON session_tags(session_id)
    `
  );

  safeRun(
    db,
    `
    CREATE INDEX IF NOT EXISTS session_tags_tag_idx
    ON session_tags(tag)
    `
  );
};
