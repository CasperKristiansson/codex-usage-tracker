"use client";

import { useEffect, useState } from "react";

import { DEFAULT_TIMEZONE, normalizeTimeZone } from "@/lib/timezone";

export type DensityMode = "comfortable" | "compact";

export type Settings = {
  dbPath: string;
  showCost: boolean;
  density: DensityMode;
  timezone: string;
};

const STORAGE_KEY = "cut.settings";

const DEFAULT_SETTINGS: Settings = {
  dbPath: "",
  showCost: true,
  density: "comfortable",
  timezone: DEFAULT_TIMEZONE
};

const listeners = new Set<(settings: Settings) => void>();
let timezoneHydratedKey: string | null = null;

const readSettings = (): Settings => {
  if (typeof window === "undefined") return DEFAULT_SETTINGS;
  const raw = window.localStorage.getItem(STORAGE_KEY);
  if (!raw) return DEFAULT_SETTINGS;
  try {
    const parsed = JSON.parse(raw) as Partial<Settings>;
    return {
      ...DEFAULT_SETTINGS,
      ...parsed,
      timezone: normalizeTimeZone(parsed.timezone ?? DEFAULT_SETTINGS.timezone)
    };
  } catch {
    return DEFAULT_SETTINGS;
  }
};

const writeSettings = (next: Settings) => {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  listeners.forEach((listener) => listener(next));
};

export const useSettings = () => {
  const [settings, setSettings] = useState<Settings>(() => readSettings());

  useEffect(() => {
    const handler = (next: Settings) => setSettings(next);
    listeners.add(handler);
    return () => {
      listeners.delete(handler);
    };
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const dbPath = settings.dbPath?.trim() ?? "";
    if (timezoneHydratedKey === dbPath) return;
    timezoneHydratedKey = dbPath;
    const params = new URLSearchParams();
    if (dbPath) params.set("db", dbPath);
    const url = params.toString()
      ? `/api/settings/timezone?${params.toString()}`
      : "/api/settings/timezone";
    fetch(url)
      .then((res) => (res.ok ? res.json() : null))
      .then((payload) => {
        const candidate = payload?.timezone;
        if (typeof candidate !== "string") return;
        const normalized = normalizeTimeZone(candidate);
        const current = readSettings();
        if (current.timezone === normalized) return;
        const next = { ...current, timezone: normalized };
        writeSettings(next);
        setSettings(next);
      })
      .catch(() => null);
  }, [settings.dbPath]);

  const updateSettings = (patch: Partial<Settings>) => {
    const next = {
      ...readSettings(),
      ...patch
    };
    next.timezone = normalizeTimeZone(next.timezone);
    writeSettings(next);
    setSettings(next);
  };

  const resetSettings = () => {
    writeSettings(DEFAULT_SETTINGS);
    setSettings(DEFAULT_SETTINGS);
  };

  return {
    settings,
    updateSettings,
    resetSettings
  };
};
