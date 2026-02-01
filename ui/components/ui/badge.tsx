import type { HTMLAttributes } from "react";

import { cn } from "@/lib/utils";

export type BadgeProps = HTMLAttributes<HTMLDivElement>;

const Badge = ({ className, ...props }: BadgeProps) => (
  <div
    className={cn(
      "inline-flex items-center rounded-full border border-border/40 bg-muted/40 px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-[0.2em] text-muted-foreground",
      className
    )}
    {...props}
  />
);

export { Badge };
