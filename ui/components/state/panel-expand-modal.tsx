"use client";

import type { ReactNode } from "react";
import { useEffect } from "react";
import { Maximize2, X } from "lucide-react";

import { ExportMenu } from "@/components/state/export-menu";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export type PanelExpandModalProps = {
  open: boolean;
  title: string;
  subtitle?: string;
  children: ReactNode;
  onClose: () => void;
  exportData?: unknown;
  exportFileBase?: string;
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
  className
}: PanelExpandModalProps) => {
  useEffect(() => {
    if (!open) return;
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50">
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
            {exportData ? (
              <ExportMenu data={exportData} title={title} fileBase={exportFileBase} />
            ) : null}
            <Button variant="ghost" size="icon" onClick={onClose} aria-label="Close">
              <X className="h-4 w-4" />
            </Button>
          </div>
        </div>
        <div className="flex-1 overflow-auto px-5 py-4">
          <div className="min-h-[360px]">{children}</div>
        </div>
      </div>
    </div>
  );
};

export { PanelExpandModal };
