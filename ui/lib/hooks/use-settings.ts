"use client";

import { useEffect, useState } from "react";

export type DensityMode = "comfortable" | "compact";

export type Settings = {
  dbPath: string;
  showCost: boolean;
  density: DensityMode;
};

const STORAGE_KEY = "cut.settings";

const DEFAULT_SETTINGS: Settings = {
  dbPath: "",
  showCost: true,
  density: "comfortable"
};

const listeners = new Set<(settings: Settings) => void>();

const readSettings = (): Settings => {
  if (typeof window === "undefined") return DEFAULT_SETTINGS;
  const raw = window.localStorage.getItem(STORAGE_KEY);
  if (!raw) return DEFAULT_SETTINGS;
  try {
    const parsed = JSON.parse(raw) as Partial<Settings>;
    return {
      ...DEFAULT_SETTINGS,
      ...parsed
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

  const updateSettings = (patch: Partial<Settings>) => {
    const next = {
      ...readSettings(),
      ...patch
    };
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
