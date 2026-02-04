"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { CornerDownRight } from "lucide-react";

import { Button } from "@/components/ui/button";
import { asRoute, cn } from "@/lib/utils";

type DrilldownMenuProps = {
  queryParams?: string;
  className?: string;
};

type DrilldownView = "sessions" | "turns" | "tool_calls";

const DrilldownMenu = ({ queryParams, className }: DrilldownMenuProps) => {
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const router = useRouter();

  const baseParams = useMemo(
    () => new URLSearchParams(queryParams ?? ""),
    [queryParams]
  );

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

  const goTo = (view: DrilldownView) => {
    const params = new URLSearchParams(baseParams);
    params.set("view", view);
    router.push(asRoute(`/sessions?${params.toString()}`));
    setOpen(false);
  };

  return (
    <div ref={menuRef} className={cn("relative", className)}>
      <Button
        variant="ghost"
        size="icon"
        aria-label="Drill down"
        onClick={() => setOpen((prev) => !prev)}
      >
        <CornerDownRight className="h-4 w-4" />
      </Button>
      {open ? (
        <div className="absolute right-0 top-11 z-20 w-44 rounded-lg border border-border/30 bg-popover p-1 shadow-lg">
          <div className="px-3 py-2 text-[11px] uppercase tracking-[0.2em] text-muted-foreground">
            Drill down
          </div>
          <button
            type="button"
            className="w-full rounded-md px-3 py-2 text-left text-xs text-foreground transition hover:bg-muted/40"
            onClick={() => goTo("sessions")}
          >
            Sessions
          </button>
          <button
            type="button"
            className="w-full rounded-md px-3 py-2 text-left text-xs text-foreground transition hover:bg-muted/40"
            onClick={() => goTo("turns")}
          >
            Turns
          </button>
          <button
            type="button"
            className="w-full rounded-md px-3 py-2 text-left text-xs text-foreground transition hover:bg-muted/40"
            onClick={() => goTo("tool_calls")}
          >
            Tool calls
          </button>
        </div>
      ) : null}
    </div>
  );
};

export { DrilldownMenu };
