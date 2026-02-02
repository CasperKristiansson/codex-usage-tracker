"use client";

import type { ReactNode } from "react";
import { useState } from "react";
import { Maximize2 } from "lucide-react";

import { ExportMenu } from "@/components/state/export-menu";
import { PanelExpandModal } from "@/components/state/panel-expand-modal";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type CardPanelProps = {
  title: string;
  subtitle?: string;
  actions?: ReactNode;
  footer?: ReactNode;
  children: ReactNode;
  className?: string;
  exportData?: unknown;
  exportFileBase?: string;
  expandable?: boolean;
  expandedContent?: ReactNode;
  expandedClassName?: string;
  queryParams?: string;
};

const CardPanel = ({
  title,
  subtitle,
  actions,
  footer,
  children,
  className,
  exportData,
  exportFileBase,
  expandable = false,
  expandedContent,
  expandedClassName,
  queryParams
}: CardPanelProps) => {
  const [expanded, setExpanded] = useState(false);

  const showExport = exportData !== undefined;
  const showExpand = expandable;

  return (
    <section className={cn("card-panel flex flex-col", className)}>
      <div className="card-header">
        <div>
          <div className="card-title">{title}</div>
          {subtitle ? <div className="card-subtitle">{subtitle}</div> : null}
        </div>
        <div className="flex items-center gap-2">
          {actions}
          {showExport ? (
            <ExportMenu data={exportData} title={title} fileBase={exportFileBase} />
          ) : null}
          {showExpand ? (
            <Button
              variant="ghost"
              size="icon"
              aria-label="Expand"
              onClick={() => setExpanded(true)}
            >
              <Maximize2 className="h-4 w-4" />
            </Button>
          ) : null}
        </div>
      </div>
      <div className="card-body flex-1">{children}</div>
      {footer ? (
        <div className="card-footer border-t border-border/15 text-xs text-muted-foreground">
          {footer}
        </div>
      ) : null}
      {showExpand ? (
        <PanelExpandModal
          open={expanded}
          title={title}
          subtitle={subtitle}
          onClose={() => setExpanded(false)}
          exportData={exportData}
          exportFileBase={exportFileBase}
          queryParams={queryParams}
          className={expandedClassName}
        >
          {expandedContent ?? children}
        </PanelExpandModal>
      ) : null}
    </section>
  );
};

export { CardPanel };
