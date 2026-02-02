"use client";

import { useEffect } from "react";

import { useSettings } from "@/lib/hooks/use-settings";

const SettingsSync = () => {
  const { settings } = useSettings();

  useEffect(() => {
    document.documentElement.classList.toggle(
      "density-compact",
      settings.density === "compact"
    );
  }, [settings.density]);

  return null;
};

export { SettingsSync };
