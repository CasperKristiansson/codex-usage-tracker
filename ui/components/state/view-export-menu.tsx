"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Download } from "lucide-react";

import type { Filters } from "@/lib/filters";
import { normalizeExportRows, toCsv, toFileBase } from "@/lib/export";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type ViewExportMenuProps = {
  title: string;
  filters: Filters;
  datasets: Record<string, unknown>;
  className?: string;
};

const buildFilterMeta = (filters: Filters) => ({
  filter_from: filters.from,
  filter_to: filters.to,
  filter_bucket: filters.bucket,
  filter_topN: filters.topN,
  filter_models: filters.models.join("|"),
  filter_dirs: filters.dirs.join("|"),
  filter_source: filters.source.join("|")
});

const buildRows = (datasets: Record<string, unknown>, filters: Filters) => {
  const filterMeta = buildFilterMeta(filters);
  const rows: Array<Record<string, unknown>> = [];
  Object.entries(datasets).forEach(([key, data]) => {
    const normalized = normalizeExportRows(data);
    normalized.forEach((row) => {
      rows.push({ dataset: key, ...filterMeta, ...row });
    });
  });
  return rows;
};

const downloadBlob = (content: string, filename: string, type: string) => {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
};

const ViewExportMenu = ({ title, filters, datasets, className }: ViewExportMenuProps) => {
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const base = useMemo(() => toFileBase(`${title}-view`), [title]);
  const payload = useMemo(
    () => ({
      page: title,
      generated_at: new Date().toISOString(),
      filters,
      datasets
    }),
    [datasets, filters, title]
  );
  const rows = useMemo(() => buildRows(datasets, filters), [datasets, filters]);
  const disabled = rows.length === 0;

  useEffect(() => {
    if (!open) return;
    const handleClick = (event: MouseEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    window.addEventListener("mousedown", handleClick);
    window.addEventListener("keydown", handleKey);
    return () => {
      window.removeEventListener("mousedown", handleClick);
      window.removeEventListener("keydown", handleKey);
    };
  }, [open]);

  return (
    <div ref={menuRef} className={cn("relative", className)}>
      <Button
        type="button"
        size="sm"
        variant="outline"
        onClick={() => setOpen((prev) => !prev)}
        disabled={disabled}
      >
        <Download className="h-3.5 w-3.5" />
        Export view
      </Button>
      {open ? (
        <div className="absolute right-0 top-11 z-20 w-40 rounded-lg border border-border/30 bg-popover p-1 shadow-lg">
          <button
            type="button"
            className="w-full rounded-md px-3 py-2 text-left text-xs text-foreground transition hover:bg-muted/40"
            onClick={() => {
              downloadBlob(
                JSON.stringify(payload, null, 2),
                `${base}.json`,
                "application/json"
              );
              setOpen(false);
            }}
          >
            Export JSON
          </button>
          <button
            type="button"
            className="w-full rounded-md px-3 py-2 text-left text-xs text-foreground transition hover:bg-muted/40"
            onClick={() => {
              downloadBlob(toCsv(rows), `${base}.csv`, "text/csv");
              setOpen(false);
            }}
          >
            Export CSV
          </button>
        </div>
      ) : null}
    </div>
  );
};

export { ViewExportMenu };
