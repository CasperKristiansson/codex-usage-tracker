"use client";
/* eslint-disable react-hooks/set-state-in-effect */

import { useCallback, useEffect, useMemo, useState } from "react";

import { useSettings } from "@/lib/hooks/use-settings";

type CacheEntry<T> = {
  data?: T;
  error?: Error;
  timestamp: number;
  promise?: Promise<T>;
};

type UseApiOptions = {
  ttl?: number;
  disabled?: boolean;
};

type ApiState<T> = {
  data?: T;
  error?: Error;
  isLoading: boolean;
  isStale: boolean;
};

const DEFAULT_TTL = 30_000;
const MAX_CACHE_ENTRIES = 200;
const MAX_CACHE_AGE = 10 * 60 * 1000;
const cache = new Map<string, CacheEntry<unknown>>();

const isAbortError = (error: unknown) => {
  if (!error || typeof error !== "object") return false;
  const named = error as { name?: unknown };
  return named.name === "AbortError";
};

const pruneCache = () => {
  if (cache.size === 0) return;
  const now = Date.now();
  for (const [key, entry] of cache.entries()) {
    if (entry.promise) continue;
    if (now - entry.timestamp > MAX_CACHE_AGE) {
      cache.delete(key);
    }
  }
  if (cache.size <= MAX_CACHE_ENTRIES) return;
  const candidates = Array.from(cache.entries())
    .filter(([, entry]) => !entry.promise)
    .sort((a, b) => a[1].timestamp - b[1].timestamp);
  const overflow = cache.size - MAX_CACHE_ENTRIES;
  candidates.slice(0, overflow).forEach(([key]) => cache.delete(key));
};

const fetchJson = async <T,>(key: string): Promise<T> => {
  const response = await fetch(key, {
    method: "GET",
    headers: {
      "Content-Type": "application/json"
    },
  });

  if (!response.ok) {
    const text = await response.text();
    const error = new Error(
      `Request failed (${response.status} ${response.statusText})`
    );
    (error as Error & { details?: string }).details = text;
    throw error;
  }

  return response.json() as Promise<T>;
};

export const useApi = <T,>(key: string | null, options?: UseApiOptions) => {
  const ttl = options?.ttl ?? DEFAULT_TTL;
  const disabled = options?.disabled ?? false;
  const { settings } = useSettings();
  const resolvedKey = useMemo(() => {
    if (!key) return null;
    const dbPath = settings.dbPath?.trim();
    if (!dbPath) return key;
    if (/(?:\\?|&)db=/.test(key)) return key;
    const separator = key.includes("?") ? "&" : "?";
    return `${key}${separator}db=${encodeURIComponent(dbPath)}`;
  }, [key, settings.dbPath]);
  const [state, setState] = useState<ApiState<T>>({
    data: undefined,
    error: undefined,
    isLoading: Boolean(resolvedKey) && !disabled,
    isStale: false
  });

  const load = useCallback(
    (force = false) => {
      let active = true;
      if (!resolvedKey || disabled) {
        setState((prev) => ({
          ...prev,
          isLoading: false,
          isStale: false
        }));
        return () => {
          active = false;
        };
      }

      const now = Date.now();
      const cached = cache.get(resolvedKey) as CacheEntry<T> | undefined;
      const hasData = cached?.data !== undefined;
      const isFresh = hasData && now - cached!.timestamp < ttl;

      if (!force && isFresh) {
        setState({
          data: cached?.data,
          error: cached?.error,
          isLoading: false,
          isStale: false
        });
        return () => {
          active = false;
        };
      }

      if (!force && cached?.promise) {
        setState({
          data: cached?.data,
          error: cached?.error,
          isLoading: true,
          isStale: Boolean(cached?.data)
        });
        cached.promise
          .then((data) => {
            cache.set(resolvedKey, { data, timestamp: Date.now() });
            pruneCache();
            if (!active) return;
            setState({
              data,
              error: undefined,
              isLoading: false,
              isStale: false
            });
          })
          .catch((error: Error) => {
            if (isAbortError(error)) {
              // Treat aborts (navigation, browser cancellations) as a non-event.
              cache.set(resolvedKey, {
                data: cached?.data,
                error: cached?.error,
                timestamp: cached?.timestamp ?? 0
              });
              pruneCache();
              if (!active) return;
              setState({
                data: cached?.data,
                error: cached?.error,
                isLoading: false,
                isStale: false
              });
              return;
            }
            cache.set(resolvedKey, {
              data: cached?.data,
              error,
              timestamp: Date.now()
            });
            pruneCache();
            if (!active) return;
            setState({
              data: cached?.data,
              error,
              isLoading: false,
              isStale: false
            });
          });
        return () => {
          active = false;
        };
      }

      const promise = fetchJson<T>(resolvedKey);
      cache.set(resolvedKey, {
        data: cached?.data,
        error: undefined,
        timestamp: cached?.timestamp ?? 0,
        promise
      });
      pruneCache();

      setState({
        data: cached?.data,
        error: undefined,
        isLoading: true,
        isStale: Boolean(cached?.data)
      });

      promise
        .then((data) => {
          cache.set(resolvedKey, { data, timestamp: Date.now() });
          pruneCache();
          if (!active) return;
          setState({ data, error: undefined, isLoading: false, isStale: false });
        })
        .catch((error: Error) => {
          if (isAbortError(error)) {
            cache.set(resolvedKey, {
              data: cached?.data,
              error: cached?.error,
              timestamp: cached?.timestamp ?? 0
            });
            pruneCache();
            if (!active) return;
            setState({
              data: cached?.data,
              error: cached?.error,
              isLoading: false,
              isStale: false
            });
            return;
          }
          cache.set(resolvedKey, {
            data: cached?.data,
            error,
            timestamp: Date.now()
          });
          pruneCache();
          if (!active) return;
          setState({
            data: cached?.data,
            error,
            isLoading: false,
            isStale: false
          });
        });

      return () => {
        active = false;
      };
    },
    [resolvedKey, ttl, disabled]
  );

  useEffect(() => {
    const cleanup = load();
    return () => {
      if (cleanup) cleanup();
    };
  }, [load]);

  const refetch = useCallback(() => {
    load(true);
  }, [load]);

  const result = useMemo(
    () => ({
      ...state,
      refetch
    }),
    [state, refetch]
  );

  return result;
};
