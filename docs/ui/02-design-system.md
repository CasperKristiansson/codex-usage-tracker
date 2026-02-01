# Design System (Minimal, Modern, High Contrast)

## Theme
- Default: Dark
- Optional: Light (toggle in header; persisted in localStorage)

## Typography
- Font: Inter (or Geist Sans if already available)
- Scale:
  - Page title: 20-22px, semibold
  - Section title: 14-15px, semibold, muted
  - Body: 13-14px
  - Mono (numbers): JetBrains Mono (optional) for token counts/IDs

## Spacing and Layout
- App max width: max-w-screen-2xl
- Outer padding: 24px desktop, 16px small screens
- Grid gap: 16px
- Card padding: 16px (dense), 20px (charts)
- Border radius: 12px
- Border: 1px subtle

## Color Tokens (Dark)
Use CSS variables (shadcn-compatible). Target look: midnight neutral + electric accent.

### Core
- Background: #0B1220
- Surface 1 (cards): #0F172A
- Surface 2 (elevated): #111C33
- Border: rgba(148, 163, 184, 0.14)
- Text primary: #E5E7EB
- Text muted: rgba(229, 231, 235, 0.65)

### Accent
- Primary accent: #22D3EE (electric cyan)
- Accent hover: #06B6D4
- Accent subtle bg: rgba(34, 211, 238, 0.10)

### Status
- Good: #34D399
- Warn: #FBBF24
- Bad: #F87171

## Chart Palette (fixed mapping; do not randomize)
Token mix charts:
- Input: #60A5FA
- Cached Input: #34D399
- Output: #A78BFA
- Reasoning: #FBBF24
Other categorical series (models/dirs/tools):
- Use an ordered palette of 10 distinct colors optimized for dark UI:
  1) #60A5FA
  2) #A78BFA
  3) #34D399
  4) #FBBF24
  5) #F87171
  6) #22D3EE
  7) #F472B6
  8) #FB7185
  9) #C084FC
  10) #93C5FD

## Component Styling Rules
- Cards:
  - Header row: title left, actions right (icon buttons)
  - Subtitle below title: 1 line max, muted
  - Content area: charts/tables align to card edges cleanly
- Buttons:
  - Use ghost buttons for icon actions
  - Use primary button only for explicit user actions (Apply, Export)
- Inputs:
  - Compact height, consistent spacing, label above

## Minimalism Rules (enforced)
- No more than 2 chart panels visible above the fold besides KPI strip.
- Legends are inline and compact; avoid big color blocks.
- Avoid dual axes unless absolutely necessary.
- Prefer small multiples over multi-line spaghetti.

## Microcopy (consistent phrasing)
- Time range (not date range)
- Bucket (hour/day)
- Top N
- Other
- No data for current filters (with suggestion: broaden range)

## Empty/Loading States
- Loading: skeleton blocks that match final layout dimensions.
- Empty:
  - message: No data for these filters.
  - hint: Try expanding time range or clearing model filter.
- Error:
  - message: Query failed.
  - show error code + retry button
