# App Shell and Navigation

## Layout
- Left sidebar (collapsible)
- Top header (global filters + actions)
- Main content area (page-specific grid)

### Sidebar (width 260px expanded, 72px collapsed)
Items (top to bottom):
1. App name + small LOCAL pill
2. Nav:
   - Overview
   - Context and Limits
   - Tools
   - Hotspots
   - Sessions and Debug
3. Divider
4. Settings (DB path, cost model, theme)

Sidebar behavior:
- Collapsed mode shows icons only + tooltip on hover.
- Sidebar state persists.

## Top Header (sticky)
Left:
- Page title + breadcrumb (optional)
Center:
- Global filters bar (single row)
Right:
- Theme toggle
- Export menu (CSV/JSON per panel)
- Help (opens short modal with keyboard shortcuts)
- Sync status + Sync now button (only shown when data missing)

### Global Filters Bar (single row, compact)
Required controls:
1. Time range picker
   - Presets: 24h / 7d / 14d / 30d / Custom
2. Bucket selector (Auto | Hour | Day)
3. Model multi-select (typeahead)
4. Directory filter (typeahead; supports starts with)
5. Source multi-select (only if >1 source exists)
6. Reset filters button (icon)

Rules:
- Changes update URL query params immediately (debounced 250ms).
- A small filters active dot appears when any non-default filter is set.
- If current range exceeds ingested data, show a warning pill with Sync action.

## Interaction Model
- Clicking a chart element applies a filter:
  - model bar -> sets model filter
  - directory bar -> sets directory filter
  - tool_name row -> sets tool filter (Tools page)
- Shift-click adds to existing selection (multi-select in URL)

## Keyboard Shortcuts (must implement)
- g o Overview
- g c Context and Limits
- g t Tools
- g h Hotspots
- g s Sessions
- / focus filter search (opens command palette-style popover)
- esc close modals / clear focus

## Settings Modal/Page
Tabs:
- Data source
- Cost model
- Appearance

Data source:
- DB path input (text) + Test connection
- Show basic DB stats (row counts, min/max timestamp)
- Show last sync time + last sync status
Cost model:
- Toggle Show cost estimates
- Table: model -> input $/1M, output $/1M
Appearance:
- Theme (dark/light), density (comfortable/compact)

## Routing
- / -> Overview
- /context -> Context and Limits
- /tools -> Tools
- /hotspots -> Hotspots
- /sessions -> Sessions and Debug
- /settings -> Settings
