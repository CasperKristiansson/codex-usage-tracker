"use client";

import type { ReactNode } from "react";
import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { Maximize2, X } from "lucide-react";

import { ExportMenu } from "@/components/state/export-menu";
import { Button } from "@/components/ui/button";
import { normalizeExportRows } from "@/lib/export";
import { cn } from "@/lib/utils";

export type PanelExpandModalProps = {
  open: boolean;
  title: string;
  subtitle?: string;
  children: ReactNode;
  onClose: () => void;
  exportData?: unknown;
  exportFileBase?: string;
  queryParams?: string;
  className?: string;
};

const PanelExpandModal = ({
  open,
  title,
  subtitle,
  children,
  onClose,
  exportData,
  exportFileBase,
  queryParams,
  className
}: PanelExpandModalProps) => {
  const [copied, setCopied] = useState(false);
  const rows = useMemo(() => normalizeExportRows(exportData), [exportData]);
  const maxRows = 50;
  const visibleRows = rows.slice(0, maxRows);
  const columns = useMemo(() => {
    const keys = new Set<string>();
    visibleRows.forEach((row) => {
      Object.keys(row).forEach((key) => keys.add(key));
    });
    return Array.from(keys);
  }, [visibleRows]);

  const handleCopy = async () => {
    if (!queryParams) return;
    try {
      await navigator.clipboard.writeText(queryParams);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      setCopied(false);
    }
  };
  useEffect(() => {
    if (!open) return;
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [open, onClose]);

  if (!open) return null;
  if (typeof document === "undefined") return null;

  return createPortal(
    <div className="panel-expand-modal fixed inset-0 z-50">
      <div className="absolute inset-0 bg-black/55 backdrop-blur-sm" onClick={onClose} />
      <div
        className={cn(
          "relative z-10 mx-auto my-6 flex h-[calc(100%-3rem)] w-[min(1100px,92vw)] flex-col rounded-2xl border border-border/30 bg-card shadow-2xl",
          className
        )}
        role="dialog"
        aria-modal="true"
      >
        <div className="flex items-start justify-between gap-4 border-b border-border/20 px-5 py-4">
          <div>
            <div className="flex items-center gap-2 text-base font-semibold text-foreground">
              <Maximize2 className="h-4 w-4 text-primary" />
              {title}
            </div>
            {subtitle ? (
              <div className="text-xs text-muted-foreground">{subtitle}</div>
            ) : null}
          </div>
          <div className="flex items-center gap-2">
            {queryParams ? (
              <Button
                variant="ghost"
                size="sm"
                onClick={handleCopy}
                aria-label="Copy query params"
              >
                {copied ? "Copied" : "Copy filters"}
              </Button>
            ) : null}
            {exportData ? (
              <ExportMenu data={exportData} title={title} fileBase={exportFileBase} />
            ) : null}
            <Button variant="ghost" size="icon" onClick={onClose} aria-label="Close">
              <X className="h-4 w-4" />
            </Button>
          </div>
        </div>
        <div className="flex-1 overflow-auto px-5 py-4">
          <div className="flex flex-col gap-4">
            <div className="panel-expand-chart min-h-[360px] h-[52vh] max-h-[640px]">
              {children}
            </div>
            {exportData ? (
              <div className="rounded-xl border border-border/20 bg-muted/20 px-4 py-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="text-[11px] uppercase tracking-[0.2em] text-muted-foreground">
                    Data rows
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {rows.length} rows
                    {rows.length > visibleRows.length
                      ? ` · showing ${visibleRows.length}`
                      : ""}
                  </div>
                </div>
                {columns.length ? (
                  <div className="mt-3 max-h-80 overflow-auto rounded-lg border border-border/20 bg-card/40">
                    <table className="min-w-full text-xs">
                      <thead className="sticky top-0 bg-card text-muted-foreground">
                        <tr>
                          {columns.map((column) => (
                            <th
                              key={column}
                              className="px-3 py-2 text-left font-medium"
                            >
                              {column}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-border/20">
                        {visibleRows.map((row, rowIndex) => (
                          <tr key={`row-${rowIndex}`}>
                            {columns.map((column) => {
                              const value = row[column];
                              const text =
                                value === null || value === undefined
                                  ? "—"
                                  : typeof value === "object"
                                    ? JSON.stringify(value)
                                    : String(value);
                              return (
                                <td
                                  key={`${rowIndex}-${column}`}
                                  className="max-w-[220px] truncate px-3 py-2 text-muted-foreground"
                                  title={text}
                                >
                                  {text}
                                </td>
                              );
                            })}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <div className="mt-3 text-xs text-muted-foreground">
                    No data rows available.
                  </div>
                )}
              </div>
            ) : null}
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
};

export { PanelExpandModal };
