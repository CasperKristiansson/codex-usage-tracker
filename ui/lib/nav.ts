import {
  BarChart3,
  Bolt,
  Database,
  Flame,
  LayoutGrid,
  Settings
} from "lucide-react";

export const navItems = [
  { href: "/", label: "Overview", icon: LayoutGrid },
  { href: "/context", label: "Context and Limits", icon: Bolt },
  { href: "/tools", label: "Tools", icon: BarChart3 },
  { href: "/hotspots", label: "Hotspots", icon: Flame },
  { href: "/sessions", label: "Sessions and Debug", icon: Database }
];

export const settingsItem = {
  href: "/settings",
  label: "Settings",
  icon: Settings
};

export const pageTitles: Record<string, string> = {
  "/": "Overview",
  "/context": "Context and Limits",
  "/tools": "Tools",
  "/hotspots": "Hotspots",
  "/sessions": "Sessions and Debug",
  "/settings": "Settings"
};

export const getPageTitle = (pathname: string) => {
  if (pathname === "/") return pageTitles["/"];
  const match = Object.keys(pageTitles).find((path) => pathname.startsWith(path));
  return match ? pageTitles[match] : "Overview";
};
