"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Search } from "lucide-react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { setFilterParam } from "@/lib/filters";
import { asRoute } from "@/lib/utils";

const isTypingTarget = (target: EventTarget | null) => {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName.toLowerCase();
  return tag === "input" || tag === "textarea" || tag === "select" || target.isContentEditable;
};

const parseCsv = (value: string) =>
  value
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);

const parseCommand = (input: string) => {
  const updates: Record<string, string[] | number | string> = {};
  const tokens = input
    .split(/\s+/)
    .map((token) => token.trim())
    .filter(Boolean);

  const free: string[] = [];

  tokens.forEach((token) => {
    const [prefix, rest] = token.split(/:(.+)/);
    if (!rest) {
      free.push(token);
      return;
    }

    const key = prefix.toLowerCase();
    if (["m", "model", "models"].includes(key)) {
      updates.models = parseCsv(rest);
      return;
    }
    if (["d", "dir", "dirs"].includes(key)) {
      updates.dirs = parseCsv(rest);
      return;
    }
    if (["s", "source", "sources"].includes(key)) {
      updates.source = parseCsv(rest);
      return;
    }
    if (["top", "topn"].includes(key)) {
      const value = Number(rest);
      if (!Number.isNaN(value)) updates.topN = value;
      return;
    }
    free.push(token);
  });

  if (free.length) {
    updates.models = parseCsv(free.join(","));
  }

  return updates;
};

const FilterCommandPalette = () => {
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState("");
  const inputRef = useRef<HTMLInputElement | null>(null);
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  useEffect(() => {
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === "/" && !isTypingTarget(event.target)) {
        event.preventDefault();
        setOpen(true);
        return;
      }
      if (event.key === "Escape" && open) {
        setOpen(false);
        setValue("");
      }
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const id = window.setTimeout(() => inputRef.current?.focus(), 0);
    return () => window.clearTimeout(id);
  }, [open]);

  const applyFilters = () => {
    const trimmed = value.trim();
    if (!trimmed) {
      setOpen(false);
      setValue("");
      return;
    }
    const updates = parseCommand(trimmed);
    const params = new URLSearchParams(searchParams.toString());

    Object.entries(updates).forEach(([key, update]) => {
      setFilterParam(params, key as never, update as never);
    });

    router.replace(asRoute(`${pathname}?${params.toString()}`), { scroll: false });
    setOpen(false);
    setValue("");
  };

  const hints = useMemo(
    () => [
      "Use m: for models, d: for dirs, s: for source",
      "Example: m:gpt-5.1,d:/apps",
      "top:20 adjusts Top N"
    ],
    []
  );

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50">
      <div
        className="absolute inset-0 bg-black/55 backdrop-blur-sm"
        onClick={() => {
          setOpen(false);
          setValue("");
        }}
      />
      <div className="relative z-10 mx-auto mt-24 w-[min(640px,92vw)]">
        <div className="rounded-2xl border border-border/30 bg-card shadow-2xl">
          <div className="flex items-center gap-3 border-b border-border/20 px-4 py-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary/15 text-primary">
              <Search className="h-4 w-4" />
            </div>
            <div>
              <div className="text-sm font-semibold text-foreground">Filter Command</div>
              <div className="text-xs text-muted-foreground">
                Type a quick filter and press Enter
              </div>
            </div>
          </div>
          <div className="px-4 py-4">
            <Input
              ref={inputRef}
              value={value}
              onChange={(event) => setValue(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  applyFilters();
                }
              }}
              placeholder="m:gpt-5.1 d:/apps top:20"
              className="text-sm"
            />
            <div className="mt-3 space-y-1 text-[11px] text-muted-foreground">
              {hints.map((hint) => (
                <div key={hint} className="flex items-center gap-2">
                  <span className="h-1 w-1 rounded-full bg-muted-foreground/60" />
                  <span>{hint}</span>
                </div>
              ))}
            </div>
            <div className="mt-4 flex justify-end gap-2">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  setOpen(false);
                  setValue("");
                }}
              >
                Cancel
              </Button>
              <Button size="sm" onClick={applyFilters}>
                Apply
              </Button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export { FilterCommandPalette };
