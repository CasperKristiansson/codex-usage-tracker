"use client";

import { useMemo } from "react";
import { useSearchParams } from "next/navigation";

import { getDefaultFilters, parseFilters } from "@/lib/filters";

export const useFilters = () => {
  const searchParams = useSearchParams();
  const defaults = useMemo(() => getDefaultFilters(), []);
  const filters = useMemo(
    () => parseFilters(new URLSearchParams(searchParams.toString()), defaults),
    [searchParams, defaults]
  );

  return { filters, defaults };
};
