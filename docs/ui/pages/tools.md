# Page Spec - Tools

## Goal
Answer:
- What tools are used (composition)?
- Which tools are failing?
- Which tools are slow (p95), and is it getting worse?

## Layout
Top: composition
Middle: failures
Bottom: latency

## Section A - Tool Composition
Card title: Tool Usage
Subtitle: What the assistant is doing
Content:
- Left: bar chart by tool_type (counts)
- Right: Top tool_name list for selected tool_type
Behavior:
- Default selected tool_type = most frequent.
- Clicking tool_type updates tool_name list.

## Section B - Tool Failures
Card title: Failures
Subtitle: Error rates by tool
Content:
- Table (Top 25 by error_rate with min_calls threshold):
  Columns:
  - tool_type
  - tool_name
  - calls
  - errors
  - error_rate
- Row click:
  - Opens a drawer showing:
    - error trend over time for that tool
    - sample recent failing calls (LIMIT 50, truncated text)
Controls:
- min_calls slider (default 50)
- status multi-select (default: exclude null and include non-success statuses)

## Section C - Tool Latency
Card title: Latency
Subtitle: p50/p95 durations from call_id pairing
Content:
- Bar chart: p95 latency by tool_name (Top 15)
- Under chart: compact table with:
  - tool_name
  - n
  - p50
  - p95
  - mean
Interactions:
- Clicking a bar filters the table to that tool and opens the drawer with:
  - latency trend (bucketed)
  - outlier list (top 20 longest calls)
Constraints:
- Must compute latency by joining start/output rows via call_id.
- Must ignore incomplete pairs safely (count separately as missing outputs).

## Debug Drawer (shared component)
For any tool_name selected:
Tabs:
1) Summary
2) Trend
3) Samples (safe-limited)
Samples tab rules:
- Requires either session_id filter OR time range <= 24h.
- Limit 200 rows.
- Truncate input/output to 800 chars with expand text button per row.
