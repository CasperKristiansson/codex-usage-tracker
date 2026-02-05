"use client";

import {
  createContext,
  useContext,
  useLayoutEffect,
  useMemo,
  useState,
  type ReactNode
} from "react";

import type { Filters } from "@/lib/filters";

export type ViewExportConfig = {
  title: string;
  filters: Filters;
  datasets: Record<string, unknown>;
};

type ViewExportContextValue = {
  config: ViewExportConfig | null;
  setConfig: (config: ViewExportConfig | null) => void;
};

const ViewExportContext = createContext<ViewExportContextValue | null>(null);

const ViewExportProvider = ({ children }: { children: ReactNode }) => {
  const [config, setConfig] = useState<ViewExportConfig | null>(null);
  const value = useMemo(() => ({ config, setConfig }), [config]);
  return <ViewExportContext.Provider value={value}>{children}</ViewExportContext.Provider>;
};

const useViewExport = () => {
  const ctx = useContext(ViewExportContext);
  if (!ctx) throw new Error("useViewExport must be used within ViewExportProvider");
  return ctx;
};

const useRegisterViewExport = (config: ViewExportConfig | null) => {
  const { setConfig } = useViewExport();
  useLayoutEffect(() => {
    setConfig(config);
    return () => setConfig(null);
  }, [config, setConfig]);
};

export { ViewExportProvider, useRegisterViewExport, useViewExport };

