"use client";

import type { ReactNode } from "react";
import { useEffect } from "react";
import { X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type SideDrawerProps = {
  open: boolean;
  title: string;
  subtitle?: string;
  children: ReactNode;
  actions?: ReactNode;
  onClose: () => void;
  className?: string;
};

const SideDrawer = ({
  open,
  title,
  subtitle,
  actions,
  children,
  onClose,
  className
}: SideDrawerProps) => {
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
      <div
        className="absolute inset-0 bg-black/50 backdrop-blur-sm"
        onClick={onClose}
      />
      <div
        className={cn(
          "absolute right-0 top-0 flex h-full w-full max-w-xl flex-col border-l border-border/30 bg-background shadow-xl",
          className
        )}
        role="dialog"
        aria-modal="true"
      >
        <div className="flex items-start justify-between gap-4 border-b border-border/20 px-5 py-4">
          <div>
            <div className="text-base font-semibold text-foreground">{title}</div>
            {subtitle ? (
              <div className="text-xs text-muted-foreground">{subtitle}</div>
            ) : null}
          </div>
          <div className="flex items-center gap-2">
            {actions}
            <Button variant="ghost" size="icon" onClick={onClose} aria-label="Close">
              <X className="h-4 w-4" />
            </Button>
          </div>
        </div>
        <div className="flex-1 overflow-y-auto px-5 py-4">{children}</div>
      </div>
    </div>
  );
};

export { SideDrawer };
