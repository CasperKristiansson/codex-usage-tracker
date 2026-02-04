"use client";

import { useEffect, useRef } from "react";

export const usePolling = (
  callback: () => void,
  intervalMs: number,
  enabled: boolean
) => {
  const callbackRef = useRef(callback);
  useEffect(() => {
    callbackRef.current = callback;
  }, [callback]);

  useEffect(() => {
    if (!enabled) return undefined;
    callbackRef.current();
    const id = setInterval(() => callbackRef.current(), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs, enabled]);
};
