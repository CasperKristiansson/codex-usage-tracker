"use client";

import { useState } from "react";
import { usePathname } from "next/navigation";
import { HelpCircle } from "lucide-react";

import { getPageTitle } from "@/lib/nav";
import GlobalFiltersBar from "@/components/filters/global-filters-bar";
import SyncStatus from "@/components/layout/sync-status";
import ThemeToggle from "@/components/layout/theme-toggle";
import { PanelExpandModal } from "@/components/state/panel-expand-modal";
import { Button } from "@/components/ui/button";

const TopHeader = () => {
  const pathname = usePathname();
  const title = getPageTitle(pathname);
  const [helpOpen, setHelpOpen] = useState(false);

  return (
    <header className="sticky top-0 z-30 border-b border-border/20 bg-background/70 backdrop-blur">
      <div className="mx-auto flex w-full max-w-screen-2xl flex-col gap-4 px-6 py-4">
        <div className="flex items-center justify-between gap-4">
          <div>
            <div className="text-lg font-semibold text-foreground">{title}</div>
            <div className="text-xs text-muted-foreground">
              Local insights for Codex usage
            </div>
          </div>
          <div className="flex items-center gap-2">
            <SyncStatus />
            <ThemeToggle />
            <Button
              variant="ghost"
              size="icon"
              aria-label="Help"
              onClick={() => setHelpOpen(true)}
            >
              <HelpCircle className="h-4 w-4" />
            </Button>
          </div>
        </div>
        <GlobalFiltersBar />
      </div>
      <PanelExpandModal
        open={helpOpen}
        onClose={() => setHelpOpen(false)}
        title="Keyboard Shortcuts"
        subtitle="Navigate faster with the keyboard"
      >
        <div className="space-y-4 text-sm text-foreground">
          <div className="grid gap-2 sm:grid-cols-2">
            <div className="rounded-lg border border-border/20 bg-muted/20 px-3 py-2">
              <div className="text-xs uppercase tracking-[0.2em] text-muted-foreground">
                Navigation
              </div>
              <div className="mt-2 space-y-1 font-mono text-xs">
                <div>g o · Overview</div>
                <div>g c · Context & Limits</div>
                <div>g t · Tools</div>
                <div>g h · Hotspots</div>
                <div>g s · Sessions</div>
              </div>
            </div>
            <div className="rounded-lg border border-border/20 bg-muted/20 px-3 py-2">
              <div className="text-xs uppercase tracking-[0.2em] text-muted-foreground">
                Filters
              </div>
              <div className="mt-2 space-y-1 font-mono text-xs">
                <div>/ · Open filter command</div>
                <div>esc · Close modals / blur</div>
              </div>
            </div>
          </div>
          <div className="text-xs text-muted-foreground">
            Filter command supports <span className="font-mono">m:</span> models,
            <span className="font-mono"> d:</span> dirs,{" "}
            <span className="font-mono">s:</span> source, and{" "}
            <span className="font-mono">top:</span> for Top N.
          </div>
        </div>
      </PanelExpandModal>
    </header>
  );
};

export default TopHeader;
