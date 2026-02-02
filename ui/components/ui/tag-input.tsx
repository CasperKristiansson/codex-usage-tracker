"use client";

import { useMemo, useRef, useState } from "react";

import { cn } from "@/lib/utils";

type TagInputProps = {
  value: string[];
  onChange: (next: string[]) => void;
  options?: string[];
  placeholder?: string;
  className?: string;
  allowCustom?: boolean;
};

const TagInput = ({
  value,
  onChange,
  options = [],
  placeholder,
  className,
  allowCustom = true
}: TagInputProps) => {
  const [input, setInput] = useState("");
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement | null>(null);

  const suggestions = useMemo(() => {
    const trimmed = input.trim().toLowerCase();
    const filtered = options.filter((option) => {
      if (value.includes(option)) return false;
      if (!trimmed) return true;
      return option.toLowerCase().includes(trimmed);
    });
    return filtered.slice(0, 8);
  }, [input, options, value]);

  const commitValues = (raw: string) => {
    const parts = raw
      .split(",")
      .map((part) => part.trim())
      .filter(Boolean);
    if (!parts.length) return;
    const next = Array.from(new Set([...value, ...parts]));
    onChange(next);
    setInput("");
  };

  return (
    <div
      ref={containerRef}
      className={cn("relative", className)}
      onFocus={() => setOpen(true)}
      onBlur={(event) => {
        if (!containerRef.current?.contains(event.relatedTarget as Node)) {
          setOpen(false);
        }
      }}
    >
      <div className="flex min-h-[36px] flex-wrap items-center gap-2 rounded-md border border-border/40 bg-background px-2 py-1 text-sm">
        {value.map((item) => (
          <button
            key={item}
            type="button"
            onClick={() => onChange(value.filter((entry) => entry !== item))}
            className="rounded-full border border-border/40 bg-muted/30 px-2 py-0.5 text-xs text-foreground"
          >
            {item}
          </button>
        ))}
        <input
          value={input}
          onChange={(event) => setInput(event.target.value)}
          placeholder={value.length ? "" : placeholder}
          className="min-w-[120px] flex-1 bg-transparent text-xs text-foreground outline-none placeholder:text-muted-foreground"
          onKeyDown={(event) => {
            if (event.key === "Enter" || event.key === ",") {
              event.preventDefault();
              if (allowCustom) commitValues(input);
            }
            if (event.key === "Backspace" && !input && value.length) {
              onChange(value.slice(0, -1));
            }
          }}
        />
      </div>
      {open && suggestions.length ? (
        <div className="absolute z-20 mt-2 w-full rounded-lg border border-border/30 bg-popover p-1 shadow-lg">
          {suggestions.map((option) => (
            <button
              key={option}
              type="button"
              onClick={() => commitValues(option)}
              className="w-full rounded-md px-3 py-2 text-left text-xs text-foreground transition hover:bg-muted/40"
            >
              {option}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
};

export { TagInput };
