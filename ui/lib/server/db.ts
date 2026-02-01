import Database from "better-sqlite3";

import { resolveDbPath } from "@/lib/server/paths";

type DbInstance = InstanceType<typeof Database>;

let db: DbInstance | null = null;

export const getDb = () => {
  if (!db) {
    const dbPath = resolveDbPath();
    db = new Database(dbPath, {
      readonly: true,
      fileMustExist: true
    });
  }
  return db;
};
