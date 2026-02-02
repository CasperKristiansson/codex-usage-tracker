"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ChevronLeft, ChevronRight } from "lucide-react";

import { navItems, settingsItem } from "@/lib/nav";
import { asRoute, cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

type SidebarNavProps = {
  collapsed: boolean;
  onToggle: () => void;
};

const SidebarNav = ({ collapsed, onToggle }: SidebarNavProps) => {
  const pathname = usePathname();

  const SettingsIcon = settingsItem.icon;

  return (
    <aside
      className={cn(
        "flex h-screen flex-col border-r border-border/20 bg-card/70 px-3 py-5 backdrop-blur",
        collapsed ? "w-[72px]" : "w-[260px]"
      )}
    >
      <div className={cn("flex items-center gap-3", collapsed ? "justify-center" : "px-1")}> 
        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/15 text-primary">
          <span className="text-sm font-semibold">CU</span>
        </div>
        {!collapsed ? (
          <div className="flex flex-col">
            <span className="text-sm font-semibold">Codex Usage</span>
            <Badge className="mt-1 w-fit">Local</Badge>
          </div>
        ) : null}
      </div>

      <nav className={cn("mt-8 flex flex-1 flex-col gap-1", collapsed ? "items-center" : "")}> 
        {navItems.map((item) => {
          const Icon = item.icon;
          const isActive = pathname === item.href;
          return (
            <Link
              key={item.href}
              href={asRoute(item.href)}
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
        <Button
          variant="ghost"
          size="icon"
          onClick={onToggle}
          className="self-center"
          aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
        >
          {collapsed ? <ChevronRight className="h-4 w-4" /> : <ChevronLeft className="h-4 w-4" />}
        </Button>
      </div>
    </aside>
  );
};

export default SidebarNav;
