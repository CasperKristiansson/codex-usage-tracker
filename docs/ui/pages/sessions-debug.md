# Page Spec - Sessions and Debug

## Goal
Safely investigate without loading huge text tables:
- Find sessions matching anomalies (high tokens, low context, high tool errors)
- Drill into one session: summary -> turn-level -> text/tool samples (limited)

## Layout
Two-column:
Left (8 cols): session list
Right (4 cols): filters + saved views + quick stats

## Left: Sessions List
Card title: Sessions
Controls (top of list):
- Search by session_id (exact/prefix)
- Sort: tokens desc (default), newest, lowest context, highest tool error rate
- Toggles:
  - Only sessions with compaction
  - Only sessions with tool errors
Table columns (compact):
- session_id
- timestamp (start)
- tokens
- turns
- tokens/turn
- min context left
- tool error rate
Row click -> opens Session Detail Drawer (right side overlay).

## Right: Anomaly Filters
Card title: Anomaly Filters
Controls:
- min tokens slider
- max min-context-left slider (e.g. show sessions that ever go < X%)
- min tool error rate slider
- model filter (inherits global)
- directory filter (inherits global)
Saved views:
- High burn
- Low context
- Tool failures
- Rollbacks/aborts

## Session Detail Drawer (must be excellent)
Header:
- Session ID (copy button)
- Badges: top model, top dir, source
Summary KPI row:
- total tokens, turns, tokens/turn, tool calls, error rate, min context left
Tabs:
1) Overview
   - mini token mix bar
   - friction events counts
   - top tools list
2) Turns (safe, paginated)
   - list of turns with:
     - turn_index
     - model
     - approval_policy
     - reasoning_effort
     - flags: has_developer_instructions, truncation_policy_mode
   - click a turn -> enable Debug tab queries
3) Debug (text/tool samples)
   Rules:
   - Must require selecting a specific turn_index OR limit to last 20 turns
   - Show:
     - content_messages snippet (user + assistant only by default)
     - tool_calls for that turn (status, tool_name, truncated input/output)
   - Hard limits:
     - max 50 messages rows
     - max 100 tool call rows
     - truncate text to 800 chars
