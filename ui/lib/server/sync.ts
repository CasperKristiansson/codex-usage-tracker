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
  return dir;
};

const writeProgress = (progressPath: string, payload: SyncProgress) => {
  const tmpPath = `${progressPath}.tmp`;
  fs.writeFileSync(tmpPath, JSON.stringify(payload));
  fs.renameSync(tmpPath, progressPath);
};

const syncKey = (filters: NormalizedFilters) => `${filters.from}|${filters.to}`;

const createSyncId = (key: string) => {
  const hash = crypto.createHash("sha1").update(key).digest("hex").slice(0, 8);
  return `sync_${Date.now()}_${hash}`;
};

export const startSync = (filters: NormalizedFilters) => {
  const registry = getRegistry();
  const key = syncKey(filters);
  const existing = registry.get(key);
  if (existing?.running) {
    return existing.syncId;
  }

  const syncId = createSyncId(key);
  const syncDir = ensureSyncDir();
  const progressPath = path.join(syncDir, `${syncId}.json`);
  const repoRoot = path.resolve(process.cwd(), "..");
  const pythonPath = path.join(repoRoot, "src");

  const args = [
    "-m",
    "codex_usage_tracker.sync_runner",
    "--db",
    resolveDbPath(),
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
