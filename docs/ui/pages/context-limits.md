# Page Spec - Context and Limits

## Goal
Identify context pressure trends, compaction behavior, and whether token burn correlates with low context headroom.

## Layout
3 vertical sections, each in its own card. Avoid more than 2 charts per card.

## Section A - Context Pressure Overview
Card title: Context Pressure
Subtitle: How close you run to context limit
Content (2-column inside card):
Left:
- Histogram (5% bins) of context_percent_left
- Vertical marker at 10% labeled danger
Right:
- Time series: danger rate (percent events <= 10%)
- Min context_percent_left line (secondary, muted)

Interactions:
- Clicking histogram bin sets a context filter (context_percent_left range) for this page only.
- Apply to global filters button appears after local context filter selection.

## Section B - Compaction and Rollbacks
Card title: State Changes Under Pressure
Subtitle: Compaction/rollback/abort over time
Content:
- Stacked bar time series:
  - context_compacted
  - thread_rolled_back
  - turn_aborted
- Below chart: small table per event_type:
  - count
  - per 1k turns (normalized rate)

## Section C - Context vs Token Burn (safe aggregation)
Card title: Token Burn vs Context Left
Subtitle: Do low-context moments cause spikes?
Content:
- Binned heatmap-like grid (not raw scatter):
  - X axis: context_percent_left bins (0-5, 5-10, ...)
  - Y axis: tokens_per_turn bins (e.g. 0-2k, 2-5k, 5-10k, 10k+)
  - Cell value: count of turns/events
- Provide toggle:
  - Count vs Avg tokens
Notes:
- This must be returned as aggregated bins from API, never raw points.

## Rate Limits Panel (small, sticky summary)
At top-right of page (or under header on small screens):
- Two mini KPI pills:
  - Min 5h headroom in range
  - Min weekly headroom in range
Click opens the full headroom card modal (reuse Overview component).

## UX Constraints
- No raw turn-level plot by default.
- No more than 1 heatmap on the page.
- All heavy queries must be bucketed/binned server-side.
