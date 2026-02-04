import { NextRequest } from "next/server";

import { getDb } from "@/lib/server/db";
import { parseFilters } from "@/lib/server/filters";
import { applyEventType, buildWhere } from "@/lib/server/query";
import { loadPricingSettings } from "@/lib/server/pricing";
import { errorResponse, jsonResponse } from "@/lib/server/response";
import { estimateCost } from "@/lib/pricing";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type ErrorSample = {
  file?: string;
  line?: number | null;
  error?: string;
  snippet?: string | null;
};

type LastIngestStats = {
  range?: { from?: string | null; to?: string | null } | null;
  files_skipped?: number | null;
  errors?: number | null;
  error_samples?: ErrorSample[];
  started_at?: string | null;
  updated_at?: string | null;
};

const parseErrorSamples = (value: unknown): ErrorSample[] => {
  if (!Array.isArray(value)) return [];
  return value
    .map((sample) => {
      if (!sample || typeof sample !== "object") return null;
      const record = sample as Record<string, unknown>;
      const lineValue = record.line;
      return {
        file: typeof record.file === "string" ? record.file : undefined,
        line:
          typeof lineValue === "number"
            ? lineValue
            : lineValue === null
              ? null
              : undefined,
        error: typeof record.error === "string" ? record.error : undefined,
        snippet:
          typeof record.snippet === "string"
            ? record.snippet
            : record.snippet === null
              ? null
              : undefined
      } as ErrorSample;
    })
    .filter(Boolean) as ErrorSample[];
};

const parseLastIngestStats = (raw?: string | null): LastIngestStats | null => {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const rangeRaw = parsed.range as Record<string, unknown> | undefined;
    return {
      range: rangeRaw
        ? {
            from:
              typeof rangeRaw.from === "string"
                ? rangeRaw.from
                : rangeRaw.from === null
                  ? null
                  : undefined,
            to:
              typeof rangeRaw.to === "string"
                ? rangeRaw.to
                : rangeRaw.to === null
                  ? null
                  : undefined
          }
        : null,
      files_skipped:
        typeof parsed.files_skipped === "number" ? parsed.files_skipped : null,
      errors: typeof parsed.errors === "number" ? parsed.errors : null,
      error_samples: parseErrorSamples(parsed.error_samples),
      started_at:
        typeof parsed.started_at === "string" ? parsed.started_at : null,
      updated_at:
        typeof parsed.updated_at === "string" ? parsed.updated_at : null
    };
  } catch {
    return null;
  }
};

export const GET = (request: NextRequest) => {
  try {
    const db = getDb(request.nextUrl.searchParams);
    const filters = parseFilters(request.nextUrl.searchParams);

    const ingestedRange = db
      .prepare(
        "SELECT MIN(captured_at_utc) as min_ts, MAX(captured_at_utc) as max_ts FROM events"
      )
      .get() as { min_ts: string | null; max_ts: string | null };
    const lastIngested = db
      .prepare("SELECT MAX(last_ingested_at) as last_ingested_at FROM ingestion_files")
      .get() as { last_ingested_at: string | null };
    const lastStatsRow = db
      .prepare("SELECT value FROM meta WHERE key = ?")
      .get("last_ingest_stats") as { value?: string } | undefined;
    const lastStats = parseLastIngestStats(lastStatsRow?.value ?? null);

    const base = buildWhere(filters, {
      timeColumn: "captured_at",
      modelColumn: "model",
      dirColumn: "directory",
      sourceColumn: "source"
    });
    const eventsWhere = applyEventType(base, "token_count");

    const tokenRow = db
      .prepare(
        `SELECT
          SUM(total_tokens) as total_tokens
        FROM events
        ${eventsWhere.sql}`
      )
      .get(eventsWhere.params) as {
      total_tokens: number | null;
    };

    const costRows = db
      .prepare(
        `SELECT model,
          SUM(input_tokens) as input_tokens,
          SUM(cached_input_tokens) as cached_input_tokens,
          SUM(output_tokens) as output_tokens,
          SUM(total_tokens) as total_tokens
        FROM events
        ${eventsWhere.sql}
        GROUP BY model`
      )
      .all(eventsWhere.params) as Array<{
      model: string | null;
      input_tokens: number | null;
      cached_input_tokens: number | null;
      output_tokens: number | null;
      total_tokens: number | null;
    }>;

    const { pricing } = loadPricingSettings(request.nextUrl.searchParams);
    let pricedTokens = 0;
    costRows.forEach((row) => {
      const cost = estimateCost(row, pricing);
      if (cost === null) return;
      pricedTokens += row.total_tokens ?? 0;
    });

    const totalTokens = tokenRow?.total_tokens ?? 0;
    const costCoverage = totalTokens ? (pricedTokens / totalTokens) * 100 : null;

    return jsonResponse({
      last_ingested_at: lastIngested?.last_ingested_at ?? null,
      ingested_range_utc: {
        from: ingestedRange?.min_ts ?? null,
        to: ingestedRange?.max_ts ?? null
      },
      last_ingest_range: lastStats?.range ?? null,
      last_ingest_at: lastStats?.updated_at ?? lastStats?.started_at ?? null,
      files_skipped: lastStats?.files_skipped ?? null,
      errors: lastStats?.errors ?? null,
      error_samples: lastStats?.error_samples ?? [],
      cost_coverage: costCoverage
    });
  } catch (error) {
    return errorResponse(
      error instanceof Error ? error.message : "Failed to load ingest health",
      500
    );
  }
};
