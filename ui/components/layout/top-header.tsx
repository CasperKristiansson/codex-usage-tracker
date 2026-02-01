"use client";

import { usePathname } from "next/navigation";
import { Download, HelpCircle } from "lucide-react";

import { getPageTitle } from "@/lib/nav";
import GlobalFiltersBar from "@/components/filters/global-filters-bar";
import SyncStatus from "@/components/layout/sync-status";
import ThemeToggle from "@/components/layout/theme-toggle";
import { Button } from "@/components/ui/button";

const TopHeader = () => {
  const pathname = usePathname();
  const title = getPageTitle(pathname);

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
            <Button variant="ghost" size="icon" aria-label="Export">
              <Download className="h-4 w-4" />
            </Button>
            <Button variant="ghost" size="icon" aria-label="Help">
              <HelpCircle className="h-4 w-4" />
            </Button>
          </div>
        </div>
        <GlobalFiltersBar />
      </div>
    </header>
  );
};

export default TopHeader;
