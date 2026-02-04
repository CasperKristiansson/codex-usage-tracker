import crypto from "crypto";
import fs from "fs";
import path from "path";
import { spawn } from "child_process";

import type { NormalizedFilters } from "@/lib/server/filters";
import { resolveDbPath, resolveRolloutsPath, resolveSyncDir } from "@/lib/server/paths";

export type SyncProgress = {
  sync_id: string;
  status: "running" | "completed" | "failed" | "unknown";
  progress?: {
    files_total?: number;
    files_parsed?: number;
    files_skipped?: number;
    lines?: number;
    events?: number;
    errors?: number;
    started_at?: number;
    updated_at?: number;
    current_file?: string | null;
    error_samples?: Array<{
      file?: string;
      line?: number | null;
      error?: string;
      snippet?: string | null;
    }>;
  } | null;
  error?: string;
};

type SyncJob = {
  syncId: string;
  key: string;
  progressPath: string;
  startedAt: number;
  running: boolean;
};

type SyncRegistry = Map<string, SyncJob>;

const SYNC_CLEANUP_AGE_MS = 7 * 24 * 60 * 60 * 1000;

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

const getRegistry = (): SyncRegistry => {
  const globalAny = globalThis as typeof globalThis & { __cutSyncJobs?: SyncRegistry };
  if (!globalAny.__cutSyncJobs) {
    globalAny.__cutSyncJobs = new Map();
  }
  return globalAny.__cutSyncJobs;
};

const ensureSyncDir = () => {
  const dir = resolveSyncDir();
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  cleanupSyncDir(dir);
  return dir;
};

const cleanupSyncDir = (dir: string) => {
  try {
    const now = Date.now();
    for (const entry of fs.readdirSync(dir)) {
      if (!entry.endsWith(".json")) continue;
      const filePath = path.join(dir, entry);
      const stat = fs.statSync(filePath);
      if (now - stat.mtimeMs > SYNC_CLEANUP_AGE_MS) {
        fs.unlinkSync(filePath);
      }
    }
  } catch {
    // best-effort cleanup
  }
};

const writeProgress = (progressPath: string, payload: SyncProgress) => {
  const tmpPath = `${progressPath}.tmp`;
  fs.writeFileSync(tmpPath, JSON.stringify(payload));
  fs.renameSync(tmpPath, progressPath);
};

const syncKey = (filters: NormalizedFilters, dbPath?: string | null) =>
  `${filters.from}|${filters.to}|${dbPath ?? "default"}`;

const createSyncId = (key: string) => {
  const hash = crypto.createHash("sha1").update(key).digest("hex").slice(0, 8);
  return `sync_${Date.now()}_${hash}`;
};

export const startSync = (filters: NormalizedFilters, dbPathOverride?: string | null) => {
  const registry = getRegistry();
  const dbPath = dbPathOverride?.trim() ? dbPathOverride.trim() : resolveDbPath();
  const key = syncKey(filters, dbPath);
  const existing = registry.get(key);
  if (existing?.running) {
    return existing.syncId;
  }

  const syncId = createSyncId(key);
  const syncDir = ensureSyncDir();
  const progressPath = path.join(syncDir, `${syncId}.json`);
  const repoRoot = resolveBackendRoot();
  const pythonPath = resolvePythonPath();

  const args = [
    "-m",
    "codex_usage_tracker.sync_runner",
    "--db",
    dbPath,
    "--rollouts",
    resolveRolloutsPath(),
    "--from",
    filters.from,
    "--to",
    filters.to,
    "--progress-file",
    progressPath,
    "--sync-id",
    syncId
  ];

  const child = spawn(process.env.PYTHON ?? "python", args, {
    cwd: repoRoot,
    env: {
      ...process.env,
      PYTHONPATH: `${pythonPath}${path.delimiter}${process.env.PYTHONPATH ?? ""}`
    },
    stdio: "ignore"
  });

  const job: SyncJob = {
    syncId,
    key,
    progressPath,
    startedAt: Date.now(),
    running: true
  };
  registry.set(key, job);

  child.on("exit", () => {
    job.running = false;
  });

  child.on("error", (error) => {
    job.running = false;
    writeProgress(progressPath, {
      sync_id: syncId,
      status: "failed",
      error: error.message
    });
  });

  return syncId;
};

export const readSyncProgress = (syncId: string): SyncProgress => {
  const progressPath = path.join(resolveSyncDir(), `${syncId}.json`);
  if (!fs.existsSync(progressPath)) {
    return { sync_id: syncId, status: "unknown" };
  }
  try {
    const payload = JSON.parse(fs.readFileSync(progressPath, "utf-8")) as SyncProgress;
    return payload;
  } catch (error) {
    return {
      sync_id: syncId,
      status: "failed",
      error: error instanceof Error ? error.message : "Invalid sync progress"
    };
  }
};
