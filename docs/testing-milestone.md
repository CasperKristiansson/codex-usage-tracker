# Testing Milestones

**Milestone 1: Test Data & Harness**
- [x] Add a deterministic fixture DB for UI tests (generate via Python `UsageStore` or commit a small SQLite fixture).
- [x] Add a Playwright `webServer` config that boots the UI with `CODEX_USAGE_DB` pointing at the fixture DB.
- [x] Add stable `data-testid` hooks for key charts, tables, and drawers to reduce selector brittleness.

**Milestone 2: Core UI E2E Flows**
- [x] Overview page loads and renders the primary KPI cards and charts.
- [x] Sidebar navigation covers Tools, Hotspots, Sessions, Settings, DB.
- [x] Sessions list opens a detail drawer and renders message + tool call samples.

**Milestone 3: Advanced UI E2E Flows**
- [ ] Tools page shows error rate chart and opens samples drawer for a tool.
- [ ] Hotspots page renders the model x directory matrix and top sessions table.
- [ ] Settings page renders DB info + pricing/timezone sections without errors.
- [ ] Empty DB state renders correctly across Overview and Sessions.

**Milestone 4: API Contract E2E**
- [ ] Playwright `request` tests for `/api/overview/*`, `/api/tools/*`, `/api/sessions/*`, `/api/hotspots/*`.
- [ ] Validate key response shapes (status, required fields, non-empty rows) against the fixture DB.
- [ ] Sync endpoints `/api/sync/start` and `/api/sync/progress` return valid states.

**Milestone 5: Backend Ingestion Integration**
- [ ] Rollout JSONL ingest covering `token_count`, `user_message`, `tool_call`, `context_compacted`, `rate_limits`.
- [ ] Verify rows in `events`, `sessions`, `turns`, `activity_events`, `tool_calls`, `content_messages`.
- [ ] Verify `--no-content` redaction prevents writing `content_messages` and `tool_calls`.

**Milestone 6: CLI Integration**
- [ ] `codex-track report --today` exits 0 and prints expected headers.
- [ ] `codex-track export --format csv` writes a CSV and includes event rows.
- [ ] `codex-track status` prints latest snapshot fields.
- [ ] `codex-track ingest-cli` and `codex-track ingest-app-server` handle a small fixture log.

**Milestone 7: Build/Install (Compile/Download)**
- [ ] `build_backend.py` builds a wheel and includes expected metadata + package files.
- [ ] `scripts/package.sh` produces `dist/` with UI standalone + `codex-track` launcher.
- [ ] `scripts/install.sh` installs into a temp dir and the resulting `codex-track` runs `--help`.
