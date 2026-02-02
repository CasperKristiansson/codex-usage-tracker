"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Download } from "lucide-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { downloadCsv, downloadJson, normalizeExportRows, toFileBase } from "@/lib/export";

type ExportMenuProps = {
  data?: unknown;
  title?: string;
  fileBase?: string;
  className?: string;
};

const ExportMenu = ({ data, title = "panel", fileBase, className }: ExportMenuProps) => {
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const rows = useMemo(() => normalizeExportRows(data), [data]);
  const disabled = !rows.length;
  const base = fileBase ?? toFileBase(title);

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
        variant="ghost"
        size="icon"
        aria-label="Export"
        onClick={() => setOpen((prev) => !prev)}
        disabled={disabled}
      >
        <Download className="h-4 w-4" />
      </Button>
      {open ? (
        <div className="absolute right-0 top-11 z-20 w-40 rounded-lg border border-border/30 bg-popover p-1 shadow-lg">
          <button
            type="button"
            className="w-full rounded-md px-3 py-2 text-left text-xs text-foreground transition hover:bg-muted/40"
            onClick={() => {
              downloadCsv(rows, `${base}.csv`);
              setOpen(false);
            }}
          >
            Export CSV
          </button>
          <button
            type="button"
            className="w-full rounded-md px-3 py-2 text-left text-xs text-foreground transition hover:bg-muted/40"
            onClick={() => {
              downloadJson(rows, `${base}.json`);
              setOpen(false);
            }}
          >
            Export JSON
          </button>
        </div>
      ) : null}
    </div>
  );
};

export { ExportMenu };
