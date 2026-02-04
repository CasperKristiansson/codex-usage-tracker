import "./globals.css";

import type { Metadata } from "next";
import { Suspense, type ReactNode } from "react";
import { Inter, JetBrains_Mono } from "next/font/google";

import AppShell from "@/components/layout/app-shell";
import { SkeletonPage } from "@/components/state/skeleton-page";

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-sans",
  display: "swap"
});

const jetbrains = JetBrains_Mono({
  subsets: ["latin"],
  variable: "--font-mono",
  display: "swap"
});

export const metadata: Metadata = {
  title: "Codex Usage Tracker",
  description: "Local usage analytics for Codex CLI"
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className="dark" suppressHydrationWarning>
      <body className={`${inter.variable} ${jetbrains.variable} font-sans`}>
        <Suspense fallback={<SkeletonPage />}>
          <AppShell>{children}</AppShell>
        </Suspense>
      </body>
    </html>
  );
}
