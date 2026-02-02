"use client";

import { useEffect, useRef } from "react";
import { usePathname, useRouter } from "next/navigation";

import { asRoute } from "@/lib/utils";
const isTypingTarget = (target: EventTarget | null) => {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName.toLowerCase();
  return tag === "input" || tag === "textarea" || tag === "select" || target.isContentEditable;
};

const routeMap: Record<string, string> = {
  o: "/",
  c: "/context",
  t: "/tools",
  h: "/hotspots",
  s: "/sessions"
};

const KeyboardShortcuts = () => {
  const router = useRouter();
  const pathname = usePathname();
  const lastG = useRef<number | null>(null);

  useEffect(() => {
    const handleKey = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey) return;

      if (event.key === "Escape") {
        if (isTypingTarget(event.target)) {
          (event.target as HTMLElement).blur();
        }
        return;
      }

      if (isTypingTarget(event.target)) return;

      if (event.key.toLowerCase() === "g") {
        lastG.current = Date.now();
        return;
      }

      if (lastG.current) {
        const elapsed = Date.now() - lastG.current;
        lastG.current = null;
        if (elapsed > 1000) return;
        const key = event.key.toLowerCase();
        const route = routeMap[key];
        if (route && route !== pathname) {
          event.preventDefault();
          router.push(asRoute(route));
        }
      }
    };

    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [pathname, router]);

  return null;
};

export { KeyboardShortcuts };
