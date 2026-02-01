# Page Spec - Hotspots

## Goal
Find the highest-burn combinations:
- model x directory
- tokens per turn distribution outliers
- top sessions by tokens

## Layout
Three cards stacked, no side-by-side to avoid visual overload.

## Section A - Model x Directory Matrix (Top-N)
Card title: Model x Directory Hotspots
Subtitle: Where tokens concentrate
Content:
- Matrix table:
  - Rows: Top 10 directories (group by depth toggle)
  - Columns: Top 6 models (by tokens)
  - Cell: total tokens (and optional percent of total)
- Last row/col: Other
Interactions:
- Clicking a cell applies both model + directory filters globally and navigates to Overview.

Visual rules:
- Use subtle heat shading (do not use neon).
- Always display numbers; shading is secondary.

## Section B - Tokens per Turn Distribution
Card title: Tokens per Turn
Subtitle: Are you creating huge turns?
Content:
- Histogram of tokens_per_turn (binned)
Bins:
- 0-1k, 1-2k, 2-5k, 5-10k, 10-20k, 20k+
Controls:
- Toggle: group by model (overlay lines) vs overall
- Toggle: show p95 marker
Interactions:
- Clicking a high bin offers action:
  - Show sessions likely in this bin (navigates to Sessions with prefilter)

## Section C - Top Sessions
Card title: Top Sessions by Tokens
Subtitle: Fast path to investigation
Content:
- Table, default sort tokens desc, paged
Columns:
- session_id
- start time
- duration (estimated: max(turn.captured_at) - min)
- tokens
- turns
- tokens/turn
- tool_calls
- min context left
- top model
- top directory
Row click opens Session Detail Drawer.

Constraints:
- This table is always filtered by current time range.
- Pagination required; default 25 rows per page.
