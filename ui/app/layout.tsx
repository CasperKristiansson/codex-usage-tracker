import "./globals.css";

import type { Metadata } from "next";
import { cookies } from "next/headers";
import { Suspense, type ReactNode } from "react";
import AppShell from "@/components/layout/app-shell";
import { SkeletonPage } from "@/components/state/skeleton-page";

export const metadata: Metadata = {
  title: "Codex Usage Tracker",
  description: "Local usage analytics for Codex CLI"
};

export default async function RootLayout({ children }: { children: ReactNode }) {
  const cookieStore = await cookies();
  const initialSidebarCollapsed =
    cookieStore.get("cut.sidebar.collapsed")?.value === "true";
  const sidebarWidth = initialSidebarCollapsed ? "72px" : "260px";

  return (
    <html lang="en" className="dark" suppressHydrationWarning>
      <body
        className="font-sans"
        suppressHydrationWarning
        style={{ ["--sidebar-width" as never]: sidebarWidth }}
      >
        <Suspense fallback={<SkeletonPage />}>
          <AppShell initialSidebarCollapsed={initialSidebarCollapsed}>
            {children}
          </AppShell>
        </Suspense>
      </body>
    </html>
  );
}
