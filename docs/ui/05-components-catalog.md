# Components Catalog (Implementation Targets)

## Layout Components
### <AppShell />
- Props: none
- Contains sidebar + header + main slot
- Persists sidebar collapsed state

### <SidebarNav />
- Items fixed (Overview, Context, Tools, Hotspots, Sessions, Settings)
- Active route highlight: left border accent + subtle bg

### <TopHeader />
- Renders page title (from route config)
- Renders <GlobalFiltersBar />
- Renders actions: ThemeToggle, ExportMenu, Help

### <GlobalFiltersBar />
Controls:
- TimeRangePicker (preset + custom)
- BucketSelect (Auto/Hour/Day)
- MultiSelect: Models
- MultiSelect: Directory prefixes
- MultiSelect: Sources (conditional)
- Reset icon button
Behavior:
- Writes to URL query string
- Debounced updates (250ms)
- Shows small active filters indicator when not default

## Common UI Components
### <CardPanel />
Standard card wrapper used everywhere.
Header:
- Title (14-15px semibold)
- Subtitle (muted, 1 line)
- Actions slot (icons)
Body:
- content slot
Footer (optional):
- summary line, e.g. Top 10 shown. 42 total.

### <KpiCard />
- Primary value (large, mono)
- Label (muted)
- Delta (optional): up/down indicator, colored warn/bad/good
- Click: opens a detail modal showing breakdown table

### <LegendInline />
- Compact legend with color dot + label + optional value
- Right aligned inside chart header area

### <TopNBarList />
- Horizontal bars with label left, value right
- Other row always last (if present)
- Clicking row applies filter

### <DataTable /> (TanStack)
- Must support:
  - sorting
  - column hide
  - compact density
  - row click
- Sticky header
- Pagination default 25 rows

## Chart Components (Recharts wrappers)
### <TimeSeriesArea />
- Single series (tokens, turns, sessions)
- Optional overlay line for avg tokens/turn
- Tooltip: bucket label + exact value + percent change vs previous bucket

### <StackedAreaTokenMix />
- Series: input, cached_input, output, reasoning
- Toggle: absolute vs percent
- Tooltip shows:
  - total
  - each component
  - cache share

### <StackedBarShare />
- Used for model share / directory share over time
- Shows Top N + Other
- Tooltip: bucket + series value + share percent

### <MinHeadroomLine />
- Lines: min 5h left, min weekly left
- Threshold bands:
  - <10% = bad
  - 10-25% = warn
- Tooltip includes reset timestamps when available in window

### <Histogram />
- Fixed bins (5% steps) for context_percent_left
- Shows vertical marker at 10% (danger)

### <LatencyBoxSummary />
- Displays p50, p95, n
- Used in Tools latency section

## Modals / Drilldowns
### <PanelExpandModal />
- Any card can expand to full-screen modal
- Keeps the same chart but adds:
  - series toggles
  - export CSV
  - copy query params button

### <SessionDetailDrawer />
- Right-side drawer for session deep dive
- Shows: KPI summary, top dirs/models/tools, friction events timeline
