import Database from "better-sqlite3";

import { resolveDbPath } from "@/lib/server/paths";

type DbInstance = InstanceType<typeof Database>;

const dbCache = new Map<string, DbInstance>();

const normalizeDbPath = (value?: string | null) => {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
};

export const resolveDbPathFromParams = (params?: URLSearchParams | null) => {
  const override = normalizeDbPath(params?.get("db") ?? null);
  return override ?? resolveDbPath();
};

export const getDb = (dbPathOrParams?: string | URLSearchParams | null) => {
  const dbPath =
    typeof dbPathOrParams === "string"
      ? normalizeDbPath(dbPathOrParams) ?? resolveDbPath()
      : resolveDbPathFromParams(dbPathOrParams ?? null);

  if (!dbCache.has(dbPath)) {
    dbCache.set(
      dbPath,
      new Database(dbPath, {
        readonly: true,
        fileMustExist: true
      })
    );
  }
  return dbCache.get(dbPath)!;
};
