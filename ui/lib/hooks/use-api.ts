"use client";
/* eslint-disable react-hooks/set-state-in-effect */

import { useCallback, useEffect, useMemo, useState } from "react";

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
const cache = new Map<string, CacheEntry<unknown>>();

const fetchJson = async <T,>(key: string, signal: AbortSignal): Promise<T> => {
  const response = await fetch(key, {
    method: "GET",
    headers: {
      "Content-Type": "application/json"
    },
    signal
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
  const [state, setState] = useState<ApiState<T>>({
    data: undefined,
    error: undefined,
    isLoading: Boolean(key) && !disabled,
    isStale: false
  });

  const load = useCallback(
    (force = false) => {
      if (!key || disabled) {
        setState((prev) => ({
          ...prev,
          isLoading: false,
          isStale: false
        }));
        return () => undefined;
      }

      const now = Date.now();
      const cached = cache.get(key) as CacheEntry<T> | undefined;
      const hasData = cached?.data !== undefined;
      const isFresh = hasData && now - cached!.timestamp < ttl;

      if (!force && isFresh) {
        setState({
          data: cached?.data,
          error: cached?.error,
          isLoading: false,
          isStale: false
        });
        return () => undefined;
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
            cache.set(key, { data, timestamp: Date.now() });
            setState({
              data,
              error: undefined,
              isLoading: false,
              isStale: false
            });
          })
          .catch((error: Error) => {
            cache.set(key, {
              data: cached?.data,
              error,
              timestamp: Date.now()
            });
            setState({
              data: cached?.data,
              error,
              isLoading: false,
              isStale: false
            });
          });
        return () => undefined;
      }

      const controller = new AbortController();
      const promise = fetchJson<T>(key, controller.signal);
      cache.set(key, {
        data: cached?.data,
        error: undefined,
        timestamp: cached?.timestamp ?? 0,
        promise
      });

      setState({
        data: cached?.data,
        error: undefined,
        isLoading: true,
        isStale: Boolean(cached?.data)
      });

      promise
        .then((data) => {
          cache.set(key, { data, timestamp: Date.now() });
          setState({ data, error: undefined, isLoading: false, isStale: false });
        })
        .catch((error: Error) => {
          if (controller.signal.aborted) return;
          cache.set(key, {
            data: cached?.data,
            error,
            timestamp: Date.now()
          });
          setState({
            data: cached?.data,
            error,
            isLoading: false,
            isStale: false
          });
        });

      return () => controller.abort();
    },
    [key, ttl, disabled]
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
