"use client";

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
  const query = filters ? buildFilterQuery(filters) : "";
  const key = filters ? `${path}?${query}` : path;
  return useApi<T>(key, options);
};
