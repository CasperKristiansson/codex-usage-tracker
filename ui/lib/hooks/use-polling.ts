"use client";

import { useEffect } from "react";

export const usePolling = (
  callback: () => void,
  intervalMs: number,
  enabled: boolean
) => {
  useEffect(() => {
    if (!enabled) return undefined;
    callback();
    const id = setInterval(callback, intervalMs);
    return () => clearInterval(id);
  }, [callback, intervalMs, enabled]);
};
