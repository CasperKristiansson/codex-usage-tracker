"use client";

import { useMemo } from "react";
import { useSearchParams } from "next/navigation";

import type { Filters } from "@/lib/filters";
import { buildFilterQuery } from "@/lib/api";
import { useApi } from "@/lib/hooks/use-api";

type EndpointOptions = {
  ttl?: number;
  disabled?: boolean;
};

export const useEndpoint = <T,>(
  path: string,
  filters?: Filters,
  options?: EndpointOptions
) => {
  const searchParams = useSearchParams();
  const query = filters ? buildFilterQuery(filters) : "";
  const key = filters ? `${path}?${query}` : path;
  const hasRequiredParams = useMemo(() => {
    if (!filters) return true;
    const required = ["from", "to", "bucket", "topN"];
    const snapshot = searchParams.toString();
    return required.every((param) => new URLSearchParams(snapshot).has(param));
  }, [filters, searchParams]);
  const disabled = options?.disabled ?? false;
  return useApi<T>(key, { ...options, disabled: disabled || !hasRequiredParams });
};
