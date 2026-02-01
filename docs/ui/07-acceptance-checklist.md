# Acceptance Checklist (UI must pass all)

## Visual Quality
- [ ] Dark theme matches tokens defined in design system
- [ ] No inconsistent padding/radius across cards
- [ ] Typography hierarchy is consistent on every page
- [ ] Charts share tooltip style and legend style
- [ ] No default browser looking inputs/buttons

## Performance and Safety
- [ ] Default view does not query unbounded rows
- [ ] All charts use bucketed aggregation and Top-N
- [ ] No chart renders >1,000 buckets per series
- [ ] Debug text endpoints enforce LIMIT + truncation
- [ ] Sessions table paginates and does not load all rows
- [ ] Missing data warning appears when range exceeds ingested data
- [ ] Sync progress is visible and updates during ingestion

## Interactions
- [ ] Clicking model/dir/tool filters the global state
- [ ] Shift-click adds to selection
- [ ] Reset filters restores defaults
- [ ] Expand modal works for each panel
- [ ] Session drawer opens from Top Sessions and Sessions page

## UX Coherence
- [ ] Every page answers one clear set of questions (no random extras)
- [ ] No page exceeds 6 major panels without collapsible sections
- [ ] Empty state messages are helpful and specific
- [ ] Export works for each panel

## Local-only Requirements
- [ ] DB path can be configured in Settings
- [ ] /api/meta shows correct min/max timestamps + row counts
- [ ] No external network calls required for core UI
