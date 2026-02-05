import "./globals.css";

import type { Metadata } from "next";
import { Suspense, type ReactNode } from "react";
import AppShell from "@/components/layout/app-shell";
import { SkeletonPage } from "@/components/state/skeleton-page";

export const metadata: Metadata = {
  title: "Codex Usage Tracker",
  description: "Local usage analytics for Codex CLI"
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className="dark" suppressHydrationWarning>
      <body className="font-sans">
        <Suspense fallback={<SkeletonPage />}>
          <AppShell>{children}</AppShell>
        </Suspense>
      </body>
    </html>
  );
}
