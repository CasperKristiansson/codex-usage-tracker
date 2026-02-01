# Milestones (Implement in order)

## M0 - Scaffold + Design System (must land first)
- [ ] Next.js + TS project bootstrapped
- [ ] Tailwind configured
- [ ] shadcn/ui installed + base theme tokens applied
- [ ] Sidebar + Header layout implemented
- [ ] Global filter state stored in URL (from/to/bucket/models/dirs/source/topN)
- [ ] Skeleton loading + empty states baseline

Acceptance:
- App renders with correct spacing, dark theme, and navigation.
- Changing filters updates URL and persists on refresh.

## M1 - Backend API (Next.js Route Handlers)
- [ ] DB adapter (better-sqlite3) + shared query builder
- [ ] Filter normalization (from/to/bucket/models/dirs/source/topN)
- [ ] /api/meta implemented (real data)
- [ ] Overview endpoints implemented (real data, aggregated)
- [ ] Enforced safety rules (limits, Top-N, bucket caps)
- [ ] Sync endpoints (status/start/progress) wired to ingestion

Acceptance:
- Overview page can render against real data without loading raw tables.
- All endpoints obey time filters and Top-N constraints.

## M2 - Client Data Layer + UI Wiring
- [ ] Client hooks (fetch + cache)
- [ ] Error handling + retry pattern
- [ ] URL <-> UI state sync
- [ ] Empty/loading states wired to real API
- [ ] Missing data warning + Sync button + progress polling

Acceptance:
- Pages render with real data and remain responsive to filters.

## M3 - Overview Page (MVP)
- [ ] KPI strip with 8 cards
- [ ] Volume chart (tokens/turns/sessions tabs)
- [ ] Token mix stacked area (+ absolute/percent toggle)
- [ ] Model share + Directory hotspots
- [ ] Context pressure card
- [ ] Rate limit headroom card
- [ ] Tools composition + Friction events

Acceptance:
- Overview page looks polished, not cluttered, and interactions filter correctly.

## M4 - Context and Limits Page
- [ ] Context histogram + danger rate timeseries
- [ ] Compaction/rollback/abort timeseries + normalized rates table
- [ ] Context vs tokens binned grid (API aggregated)

Acceptance:
- No raw scatter; performance stable.

## M5 - Tools Page
- [ ] Tool type composition + drilldown names
- [ ] Failures table + drawer + sample fetch constraints
- [ ] Latency (p50/p95) + trend + outliers

Acceptance:
- Latency computed from call_id pairing and incomplete pairs handled.

## M6 - Hotspots Page
- [ ] Model x Directory matrix (Top-N with Other)
- [ ] Tokens/turn distribution histogram with optional overlay by model
- [ ] Top sessions table + session drawer integration

Acceptance:
- Clicking matrix cell applies combined filters and navigates.

## M7 - Sessions and Debug Page
- [ ] Sessions list with anomaly filters + saved views
- [ ] Session detail drawer with tabs
- [ ] Debug tab safe limits + truncation

Acceptance:
- Debug views never load unlimited rows; requires narrow filters.

## M8 - Polish + Export + Tests
- [ ] Panel expand modal for every chart card
- [ ] Export CSV/JSON per panel
- [ ] Keyboard shortcuts
- [ ] Playwright smoke tests
- [ ] Final visual pass: spacing, typography, hover states, focus rings

Acceptance:
- Feels like a premium internal tool, not a prototype.
