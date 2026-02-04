import fs from "fs";
import path from "path";

import { resolveConfigPath } from "@/lib/server/paths";

export type ConfigPayload = Record<string, unknown>;

const resolveDbOverride = (
  value?: URLSearchParams | string | null
): string | null => {
  if (!value) return null;
  if (typeof value === "string") return value;
  return value.get("db");
};

export const loadConfigPayload = (dbOverride?: URLSearchParams | string | null) => {
  const configPath = resolveConfigPath(resolveDbOverride(dbOverride));
  if (!fs.existsSync(configPath)) {
    return { configPath, payload: {} as ConfigPayload };
  }
  try {
    const raw = fs.readFileSync(configPath, "utf-8");
    const parsed = JSON.parse(raw);
    return {
      configPath,
      payload:
        typeof parsed === "object" && parsed !== null ? (parsed as ConfigPayload) : {}
    };
  } catch {
    return { configPath, payload: {} as ConfigPayload };
  }
};

export const saveConfigPayload = (
  payload: ConfigPayload,
  dbOverride?: URLSearchParams | string | null
) => {
  const { configPath } = loadConfigPayload(dbOverride);
  if (!Object.keys(payload).length) {
    if (fs.existsSync(configPath)) {
      fs.unlinkSync(configPath);
    }
    return configPath;
  }
  fs.mkdirSync(path.dirname(configPath), { recursive: true });
  fs.writeFileSync(configPath, JSON.stringify(payload, null, 2));
  return configPath;
};
