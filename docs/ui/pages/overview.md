# Page Spec - Overview

## Goal
Answer in <30 seconds:
- Did usage spike?
- Which component (output/input/reasoning/cache) drove it?
- Which model/dir/tool explains it?
- Are we close to limits or context pressure?

## Layout (desktop)
Grid: 12 columns, gap 16px, max width 2xl.

### Section A - KPI Strip (row 1)
- 8 KPI cards in a responsive grid:
  - 4 cards on first line, 4 on second on smaller screens
Card order:
1) Total tokens
2) Input tokens
3) Output tokens
4) Reasoning tokens
5) Cached input tokens
6) Cache share (%)
7) Tool calls
8) Tool error rate (%)
Card behavior:
- Click opens modal with breakdown table by day (top 14 rows) + export.

### Section B - Volume Over Time (row 2, full width)
Card title: Usage Volume
Subtitle: Tokens vs work volume (turns/sessions)
Content:
- Tab switcher inside card header:
  - Tab 1: Tokens
  - Tab 2: Turns
  - Tab 3: Sessions
- Each tab shows a single time-series area chart.
Footer:
- Summary text: Peak day: YYYY-MM-DD; Avg/day: X; Change vs previous window: Y%

### Section C - Token Mix (row 3, full width)
Card title: Token Mix
Subtitle: What drove token changes
Content:
- Stacked area chart (input/cached/output/reasoning)
- Toggle right:
  - Absolute / Percent
- Tooltip includes: total, each component, cache share.

### Section D - Model + Directory Drivers (row 4)
Two cards side-by-side (6 cols each):

#### D1 Model Share
- Chart: stacked bars over time (Top 10 + Other)
- Below chart: compact table (Top 10 models) with:
  - tokens, share, tokens/turn
- Click model filters globally.

#### D2 Directory Hotspots
- Chart: top-N bar list by total tokens
- Toggle: Group by depth (1 segment / 2 / full)
- Click directory filters globally.

### Section E - Constraints (row 5)
Two cards side-by-side (6 cols each):

#### E1 Context Pressure
Content:
- Histogram of context_percent_left bins (5% steps)
- Above histogram: Danger rate as a mini KPI:
  - Percent of usage events with context_percent_left <= 10
- Small time-series sparkline of danger rate.

#### E2 Rate Limit Headroom
Content:
- Line chart: min 5h left, min weekly left
- Threshold bands:
  - 25% (warn)
  - 10% (bad)

### Section F - Tools + Friction (row 6)
Two cards side-by-side (6 cols each):

#### F1 Tool Composition
Content:
- Bar chart: tool_type counts
- On click tool_type -> shows inline Top tool_name list (Top 10)

#### F2 Workflow Friction
Content:
- Stacked bars over time for:
  - context_compacted
  - thread_rolled_back
  - turn_aborted
  - review mode enter/exit (optional)
Click event type filters Sessions page list (pre-applied query param).

## Minimalism constraints (enforced)
- No more than 6 major cards visible on first load; sections D/E/F can be collapsed by default on small screens.
- Tables must be compact and short (max 10 rows visible without scrolling).

## Interactions
- Any chart supports:
  - Hover tooltip
  - Click to filter
  - Expand icon -> full-screen modal
- Shift-click adds to existing filter selection.

## Export
- Each card has export menu:
  - CSV (chart series)
  - JSON (raw API response)
