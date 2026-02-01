import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

type CardPanelProps = {
  title: string;
  subtitle?: string;
  actions?: ReactNode;
  footer?: ReactNode;
  children: ReactNode;
  className?: string;
};

const CardPanel = ({
  title,
  subtitle,
  actions,
  footer,
  children,
  className
}: CardPanelProps) => {
  return (
    <section className={cn("card-panel flex flex-col", className)}>
      <div className="card-header">
        <div>
          <div className="card-title">{title}</div>
          {subtitle ? <div className="card-subtitle">{subtitle}</div> : null}
        </div>
        {actions ? <div className="flex items-center gap-2">{actions}</div> : null}
      </div>
      <div className="flex-1 px-4 py-4">{children}</div>
      {footer ? (
        <div className="border-t border-border/15 px-4 py-3 text-xs text-muted-foreground">
          {footer}
        </div>
      ) : null}
    </section>
  );
};

export { CardPanel };
