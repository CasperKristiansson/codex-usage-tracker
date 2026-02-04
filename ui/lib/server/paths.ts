import os from "os";
import path from "path";

export const resolveDbPath = () => {
  if (process.env.CODEX_USAGE_DB) {
    return process.env.CODEX_USAGE_DB;
  }

  const home = os.homedir();
  if (process.platform === "darwin") {
    return path.join(
      home,
      "Library",
      "Application Support",
      "codex-usage-tracker",
      "usage.sqlite"
    );
  }
  if (process.platform === "linux") {
    return path.join(home, ".local", "share", "codex-usage-tracker", "usage.sqlite");
  }
  return path.join(home, ".codex-usage-tracker", "usage.sqlite");
};

export const resolveConfigPath = (dbOverride?: string | null) => {
  const override = process.env.CODEX_USAGE_CONFIG?.trim();
  if (override) {
    return override;
  }
  const dbPath = dbOverride?.trim() ? dbOverride.trim() : resolveDbPath();
  return path.join(path.dirname(dbPath), "config.json");
};

export const resolveRolloutsPath = () => {
  if (process.env.CODEX_USAGE_ROLLOUTS) {
    return process.env.CODEX_USAGE_ROLLOUTS;
  }
  const home = os.homedir();
  return path.join(home, ".codex", "sessions");
};

export const resolveSyncDir = () => {
  const override = process.env.CODEX_USAGE_SYNC_DIR?.trim();
  if (override) {
    return override;
  }
  return path.join(process.cwd(), ".sync");
};
