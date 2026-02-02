"use client";

import type { ReactNode } from "react";
import { useEffect, useState } from "react";

import { FilterCommandPalette } from "@/components/filters/filter-command-palette";
import { KeyboardShortcuts } from "@/components/layout/keyboard-shortcuts";
import SidebarNav from "@/components/layout/sidebar-nav";
import TopHeader from "@/components/layout/top-header";

const STORAGE_KEY = "cut.sidebar.collapsed";

type AppShellProps = {
  children: ReactNode;
};

const AppShell = ({ children }: AppShellProps) => {
  const [collapsed, setCollapsed] = useState(() => {
    if (typeof window === "undefined") return false;
    return window.localStorage.getItem(STORAGE_KEY) === "true";
  });

  useEffect(() => {
    window.localStorage.setItem(STORAGE_KEY, String(collapsed));
  }, [collapsed]);

  return (
    <div className="flex min-h-screen">
      <KeyboardShortcuts />
      <FilterCommandPalette />
      <SidebarNav
        collapsed={collapsed}
        onToggle={() => setCollapsed((prev) => !prev)}
      />
      <div className="flex min-h-screen flex-1 flex-col">
        <TopHeader />
        <main className="flex-1">
          <div className="mx-auto w-full max-w-screen-2xl px-4 pb-12 pt-6 sm:px-6">
            {children}
          </div>
        </main>
      </div>
    </div>
  );
};

export default AppShell;
