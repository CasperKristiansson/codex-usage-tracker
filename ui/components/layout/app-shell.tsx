"use client";

import type { ReactNode } from "react";

import { FilterCommandPalette } from "@/components/filters/filter-command-palette";
import { KeyboardShortcuts } from "@/components/layout/keyboard-shortcuts";
import SidebarNav from "@/components/layout/sidebar-nav";
import TopHeader from "@/components/layout/top-header";
import { SettingsSync } from "@/components/state/settings-sync";
import { ViewExportProvider } from "@/components/state/view-export-context";

type AppShellProps = {
  children: ReactNode;
  initialSidebarCollapsed: boolean;
};

const AppShell = ({ children, initialSidebarCollapsed }: AppShellProps) => {
  return (
    <div className="min-h-screen">
      <KeyboardShortcuts />
      <FilterCommandPalette />
      <SettingsSync />
      <SidebarNav initialCollapsed={initialSidebarCollapsed} />
      <div
        className="flex min-h-screen flex-col transition-[padding-left] duration-200"
        style={{ paddingLeft: "var(--sidebar-width)" }}
      >
        <ViewExportProvider>
          <TopHeader />
          <main className="flex-1">
            <div className="mx-auto w-full max-w-screen-2xl px-4 pb-12 pt-6 sm:px-6">
              {children}
            </div>
          </main>
        </ViewExportProvider>
      </div>
    </div>
  );
};

export default AppShell;
