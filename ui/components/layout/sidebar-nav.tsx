"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { PanelLeftClose, PanelLeftOpen } from "lucide-react";
import { useCallback, useEffect, useLayoutEffect, useState } from "react";

import { navItems, settingsItem } from "@/lib/nav";
import { asRoute, cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

type SidebarNavProps = {
  initialCollapsed?: boolean;
};

const STORAGE_KEY = "cut.sidebar.collapsed";
const COOKIE_KEY = "cut.sidebar.collapsed";
const COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 365;
const COLLAPSED_WIDTH = "72px";
const EXPANDED_WIDTH = "260px";

const SidebarNav = ({ initialCollapsed = false }: SidebarNavProps) => {
  const pathname = usePathname();
  const [collapsed, setCollapsed] = useState(initialCollapsed);

  const SettingsIcon = settingsItem.icon;

  const applySidebarWidth = useCallback((nextCollapsed: boolean) => {
    const width = nextCollapsed ? COLLAPSED_WIDTH : EXPANDED_WIDTH;
    document.body.style.setProperty("--sidebar-width", width);
  }, []);

  const persistCollapsed = useCallback((next: boolean) => {
    try {
      window.localStorage.setItem(STORAGE_KEY, String(next));
    } catch {
      // Ignore storage failures (private mode, disabled storage).
    }
    document.cookie = `${COOKIE_KEY}=${String(next)}; Path=/; Max-Age=${COOKIE_MAX_AGE_SECONDS}; SameSite=Lax`;
    applySidebarWidth(next);
  }, [applySidebarWidth]);

  const handleToggle = useCallback(() => {
    setCollapsed((prev) => {
      const next = !prev;
      persistCollapsed(next);
      return next;
    });
  }, [persistCollapsed]);

  useLayoutEffect(() => {
    applySidebarWidth(collapsed);
  }, [applySidebarWidth, collapsed]);

  useEffect(() => {
    // If localStorage differs from SSR cookie, prefer localStorage after hydration.
    try {
      const stored = window.localStorage.getItem(STORAGE_KEY);
      if (stored === null) return;
      const next = stored === "true";
      if (next !== collapsed) setCollapsed(next);
    } catch {
      // Ignore
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <aside
      className={cn(
        "fixed inset-y-0 left-0 z-40 flex h-screen flex-col overflow-y-auto border-r border-border/20 bg-card/70 px-3 py-5 backdrop-blur transition-[width] duration-200"
      )}
      style={{ width: "var(--sidebar-width)" }}
    >
      <div className={cn("flex items-center gap-3 px-1", collapsed ? "justify-center" : "")}>
        {collapsed ? (
          <Button
            type="button"
            variant="ghost"
            size="icon"
            onClick={handleToggle}
            aria-label="Expand sidebar"
            title="Expand sidebar"
          >
            <PanelLeftOpen className="h-4 w-4" />
          </Button>
        ) : (
          <>
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/15 text-primary">
              <span className="text-sm font-semibold">CU</span>
            </div>
            <div className="flex flex-col">
              <span className="text-sm font-semibold">Codex Usage</span>
              <Badge className="mt-1 w-fit">Local</Badge>
            </div>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              onClick={handleToggle}
              className="ml-auto"
              aria-label="Collapse sidebar"
              title="Collapse sidebar"
            >
              <PanelLeftClose className="h-4 w-4" />
            </Button>
          </>
        )}
      </div>

      <nav
        className={cn("mt-8 flex flex-1 flex-col gap-1", collapsed ? "items-center" : "")}
        data-testid="sidebar-nav"
      >
        {navItems.map((item) => {
          const Icon = item.icon;
          const isActive = pathname === item.href;
          return (
            <Link
              key={item.href}
              href={asRoute(item.href)}
              data-testid={`nav-${item.label.toLowerCase().replace(/\s+/g, "-")}`}
              className={cn(
                "group flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
                isActive
                  ? "bg-primary/15 text-primary"
                  : "text-muted-foreground hover:bg-muted/40 hover:text-foreground",
                collapsed ? "justify-center px-2" : ""
              )}
              title={collapsed ? item.label : undefined}
            >
              <Icon className="h-4 w-4" />
              {!collapsed ? <span>{item.label}</span> : null}
            </Link>
          );
        })}
      </nav>

      <div className={cn("mt-auto flex flex-col gap-2", collapsed ? "items-center" : "")}>
        <Link
          href={asRoute(settingsItem.href)}
          data-testid="nav-settings"
          className={cn(
            "flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted/40 hover:text-foreground",
            pathname === settingsItem.href ? "bg-primary/15 text-primary" : "",
            collapsed ? "justify-center px-2" : ""
          )}
          title={collapsed ? settingsItem.label : undefined}
        >
          <SettingsIcon className="h-4 w-4" />
          {!collapsed ? <span>{settingsItem.label}</span> : null}
        </Link>
      </div>
    </aside>
  );
};

export default SidebarNav;
