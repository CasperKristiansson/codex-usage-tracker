import fs from "fs";

import { NextRequest } from "next/server";

import { getDb, resolveDbPathFromParams } from "@/lib/server/db";
import { errorResponse, jsonResponse } from "@/lib/server/response";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type LastIngestStats = {
  range?: { from?: string | null; to?: string | null } | null;
  files_skipped?: number | null;
  errors?: number | null;
  started_at?: string | null;
  updated_at?: string | null;
  error_samples?: Array<{
    file?: string;
    line?: number | null;
    error?: string;
    snippet?: string | null;
  }>;
};

const parseLastIngestStats = (raw?: string | null): LastIngestStats | null => {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const range = parsed.range as Record<string, unknown> | undefined;
    return {
      range: range
        ? {
            from:
              typeof range.from === "string"
                ? range.from
                : range.from === null
                  ? null
                  : undefined,
            to:
              typeof range.to === "string"
                ? range.to
                : range.to === null
                  ? null
                  : undefined
          }
        : null,
      files_skipped:
        typeof parsed.files_skipped === "number" ? parsed.files_skipped : null,
      errors: typeof parsed.errors === "number" ? parsed.errors : null,
      started_at: typeof parsed.started_at === "string" ? parsed.started_at : null,
      updated_at: typeof parsed.updated_at === "string" ? parsed.updated_at : null,
      error_samples: Array.isArray(parsed.error_samples)
        ? (parsed.error_samples as LastIngestStats["error_samples"])
        : undefined
    };
  } catch {
    return null;
  }
};

const sanitizeName = (value: string) => value.replace(/"/g, '""');

export const GET = (request: NextRequest) => {
  try {
    const params = request.nextUrl.searchParams;
    const activePath = resolveDbPathFromParams(params);
    const exists = fs.existsSync(activePath);
    const sizeBytes = exists ? fs.statSync(activePath).size : null;

    let error: string | null = null;
    let rowCounts: Record<string, number> | null = null;
    let tableSizes: Array<{ name: string; rows: number; bytes?: number | null }> | null =
      null;
    let ingest: Record<string, unknown> | null = null;

    try {
      const db = getDb(params);

      const tables = db
        .prepare(
          "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'"
        )
        .all() as Array<{ name: string }>;

      const sizeMap = new Map<string, number>();
      try {
        const sizeRows = db
          .prepare("SELECT name, SUM(pgsize) as bytes FROM dbstat GROUP BY name")
          .all() as Array<{ name: string; bytes: number }>;
        sizeRows.forEach((row) => {
          if (typeof row.bytes === "number") {
            sizeMap.set(row.name, row.bytes);
          }
        });
      } catch {
        // dbstat not available
      }

      tableSizes = tables.map((table) => {
        const safeName = sanitizeName(table.name);
        const count = db
          .prepare(`SELECT COUNT(*) as count FROM "${safeName}"`)
          .get() as { count: number } | undefined;
        return {
          name: table.name,
          rows: count?.count ?? 0,
          bytes: sizeMap.has(table.name) ? sizeMap.get(table.name) ?? null : null
        };
      });

      rowCounts = {
        events: db.prepare("SELECT COUNT(*) as count FROM events").get().count,
        sessions: db.prepare("SELECT COUNT(*) as count FROM sessions").get().count,
        turns: db.prepare("SELECT COUNT(*) as count FROM turns").get().count,
        tool_calls: db.prepare("SELECT COUNT(*) as count FROM tool_calls").get().count,
        content_messages: db
          .prepare("SELECT COUNT(*) as count FROM content_messages")
          .get().count,
        activity_events: db
          .prepare("SELECT COUNT(*) as count FROM activity_events")
          .get().count,
        app_turns: db.prepare("SELECT COUNT(*) as count FROM app_turns").get().count,
        app_items: db.prepare("SELECT COUNT(*) as count FROM app_items").get().count,
        weekly_quota_estimates: db
          .prepare("SELECT COUNT(*) as count FROM weekly_quota_estimates")
          .get().count,
        ingestion_files: db
          .prepare("SELECT COUNT(*) as count FROM ingestion_files")
          .get().count
      };

      const ingestedRange = db
        .prepare(
          "SELECT MIN(captured_at_utc) as min_ts, MAX(captured_at_utc) as max_ts FROM events"
        )
        .get() as { min_ts: string | null; max_ts: string | null };
      const ingestionFiles = db
        .prepare(
          "SELECT COUNT(*) as count, MIN(last_ingested_at) as first_ingested_at, MAX(last_ingested_at) as last_ingested_at FROM ingestion_files"
        )
        .get() as {
        count: number;
        first_ingested_at: string | null;
        last_ingested_at: string | null;
      };
      const ingestVersion = db
        .prepare("SELECT value FROM meta WHERE key = ?")
        .get("ingest_version") as { value?: string } | undefined;
      const schemaVersion = db
        .prepare("SELECT value FROM meta WHERE key = ?")
        .get("schema_version") as { value?: string } | undefined;
      const lastStatsRow = db
        .prepare("SELECT value FROM meta WHERE key = ?")
        .get("last_ingest_stats") as { value?: string } | undefined;
      const lastStats = parseLastIngestStats(lastStatsRow?.value ?? null);

      ingest = {
        ingest_version: ingestVersion?.value ?? null,
        schema_version: schemaVersion?.value ?? null,
        files: ingestionFiles?.count ?? null,
        first_ingested_at: ingestionFiles?.first_ingested_at ?? null,
        last_ingested_at: ingestionFiles?.last_ingested_at ?? null,
        ingested_range_utc: {
          from: ingestedRange?.min_ts ?? null,
          to: ingestedRange?.max_ts ?? null
        },
        last_ingest_stats: lastStats
      };
    } catch (err) {
      error = err instanceof Error ? err.message : "Failed to read database";
    }

    return jsonResponse({
      db: {
        path: activePath,
        exists,
        size_bytes: sizeBytes
      },
      row_counts: rowCounts,
      table_sizes: tableSizes,
      ingest,
      error
    });
  } catch (error) {
    return errorResponse(
      error instanceof Error ? error.message : "Failed to load DB insights",
      500
    );
  }
};
