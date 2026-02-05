import { execFileSync } from "child_process";
import fs from "fs";
import path from "path";

import { resolveDbPath } from "@/lib/server/paths";

type BetterSqlite3 = typeof import("better-sqlite3");
type DbInstance = InstanceType<BetterSqlite3>;

const dbCache = new Map<string, DbInstance>();
const initCache = new Set<string>();
let Database: BetterSqlite3 | null = null;
let databaseLoadError: Error | null = null;

const loadDatabase = () => {
  if (Database || databaseLoadError) return;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    Database = require("better-sqlite3");
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    databaseLoadError = new Error(
      [
        "Failed to load better-sqlite3 native bindings.",
        message,
        `Node: ${process.versions.node}`,
        "Try using a supported Node LTS version (20 or 22) and rerun ./scripts/install.sh.",
        "On macOS, you may need Xcode Command Line Tools: xcode-select --install.",
      ].join(" "),
    );
  }
};

const resolveBackendRoot = () => {
  const override = process.env.CODEX_USAGE_BACKEND_ROOT?.trim();
  if (override) {
    return path.resolve(override);
  }
  return path.resolve(process.cwd(), "..");
};

const resolvePythonPath = () => {
  const override = process.env.CODEX_USAGE_PYTHONPATH?.trim();
  if (override) {
    return override;
  }
  return path.join(resolveBackendRoot(), "src");
};

const ensureDbExists = (dbPath: string) => {
  if (initCache.has(dbPath)) return;
  if (fs.existsSync(dbPath)) {
    initCache.add(dbPath);
    return;
  }

  fs.mkdirSync(path.dirname(dbPath), { recursive: true });

  const python = process.env.PYTHON ?? "python";
  const pythonPath = resolvePythonPath();
  const env = {
    ...process.env,
    PYTHONPATH: `${pythonPath}${path.delimiter}${process.env.PYTHONPATH ?? ""}`,
  };

  try {
    execFileSync(
      python,
      [
        "-c",
        [
          "from pathlib import Path",
          "import sys",
          "from codex_usage_tracker.store import UsageStore",
          "UsageStore(Path(sys.argv[1])).close()",
        ].join("; "),
        dbPath,
      ],
      { env, stdio: "ignore" },
    );
    initCache.add(dbPath);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to init DB";
    throw new Error(message);
  }
};

const normalizeDbPath = (value?: string | null) => {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
};

export const resolveDbPathFromParams = (params?: URLSearchParams | null) => {
  const override = normalizeDbPath(params?.get("db") ?? null);
  return override ?? resolveDbPath();
};

export const getDb = (dbPathOrParams?: string | URLSearchParams | null) => {
  loadDatabase();
  if (!Database) {
    throw databaseLoadError ?? new Error("Failed to load better-sqlite3.");
  }
  const dbPath =
    typeof dbPathOrParams === "string"
      ? (normalizeDbPath(dbPathOrParams) ?? resolveDbPath())
      : resolveDbPathFromParams(dbPathOrParams ?? null);

  if (!dbCache.has(dbPath)) {
    ensureDbExists(dbPath);
    dbCache.set(
      dbPath,
      new Database(dbPath, {
        readonly: true,
        fileMustExist: true,
      }),
    );
  }
  return dbCache.get(dbPath)!;
};
