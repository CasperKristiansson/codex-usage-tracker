"use client";

import { useMemo } from "react";
import { useSearchParams } from "next/navigation";

import { getDefaultFilters, parseFilters } from "@/lib/filters";
import { useSettings } from "@/lib/hooks/use-settings";

export const useFilters = () => {
  const searchParams = useSearchParams();
  const { settings } = useSettings();
  const defaults = useMemo(
    () => getDefaultFilters(settings.timezone),
    [settings.timezone]
  );
  const filters = useMemo(
    () => parseFilters(new URLSearchParams(searchParams.toString()), defaults),
    [searchParams, defaults]
  );

  return { filters, defaults };
};
