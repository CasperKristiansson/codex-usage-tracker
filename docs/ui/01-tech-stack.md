# Tech Stack (UI-first, design-perfect)

## Decision: Framework and UI System
### Framework
- React + TypeScript, built with Next.js (App Router).
Reason:
- Modern routing, layouts, and server route handlers (for local SQLite access) without building a separate backend service.
- Excellent ecosystem for polished UI, charts, tables, and state.

Note: Backend is intentionally minimal. Route handlers only return aggregated JSON.

### UI Framework (for perfect design)
- Tailwind CSS for layout/spacing.
- shadcn/ui (Radix primitives) for consistent, modern components.
- lucide-react icons.

### Data Viz + Tables
- Charts: Recharts
  - Clean defaults, easy tooltips/legends, fast for aggregated series.
- Tables: TanStack Table + shadcn Table styling.
  - Supports sorting, filtering, pagination, and row click drilldown.

### State and URL Sync
- Global filters stored in URL query params (shareable, refresh-safe).
- Use a small client state store (Zustand) for ephemeral UI state:
  - expanded panels, pinned comparisons, selected items.

### Date Utilities
- date-fns for formatting, bucketing labels, and timezone display.

### Quality Tooling
- pnpm
- ESLint + Prettier
- TypeScript strict mode
- Playwright (smoke navigation tests)

## Local SQLite Access (minimal backend)
- Node package: better-sqlite3 (fast, sync, simple).
- A single DB adapter with:
  - open DB path
  - execute parameterized queries
  - return aggregated rows only

## App Structure
- app/ for pages and layouts
- app/api/ route handlers for aggregated endpoints
- components/ for UI building blocks
- lib/ for:
  - db adapter
  - query builders (SQL outlines)
  - formatting (tokens, durations, percent)
- docs/ui/ for specs

## Performance Targets
- Overview page loads in < 800ms for 14d window on 150k events / 145k tool_calls.
- No chart renders more than:
  - 1,000 points per series (bucketed)
  - 10-20 series (Top-N + Other)

## Visual Consistency Requirements
- All cards use the same padding, radius, border, and header layout.
- All charts use consistent typography, tick density, and tooltip style.
- All Top-N charts include an Other grouping.
