import { NextRequest } from "next/server";

import { getDb } from "@/lib/server/db";
import { parseFilters } from "@/lib/server/filters";
import { errorResponse, jsonResponse } from "@/lib/server/response";
import { parseIsoToMs } from "@/lib/timezone";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = (request: NextRequest) => {
  try {
    const filters = parseFilters(request.nextUrl.searchParams);
    const db = getDb(request.nextUrl.searchParams);

    const ingested = db
      .prepare(
        "SELECT MIN(captured_at_utc) as min_ts, MAX(captured_at_utc) as max_ts FROM events"
      )
      .get() as { min_ts: string | null; max_ts: string | null };
    const lastIngested = db
      .prepare("SELECT MAX(last_ingested_at) as last_ingested_at FROM ingestion_files")
      .get() as { last_ingested_at: string | null };

    const ingestedFrom = ingested?.min_ts ?? null;
    const ingestedTo = ingested?.max_ts ?? null;
    const fromMs = parseIsoToMs(filters.from);
    const toMs = parseIsoToMs(filters.to);
    const ingestedFromMs = parseIsoToMs(ingestedFrom);
    const ingestedToMs = parseIsoToMs(ingestedTo);
    const MISSING_GRACE_MS = 5 * 60 * 1000;
    const isMissing =
      !ingestedFromMs ||
      !ingestedToMs ||
      !fromMs ||
      !toMs ||
      fromMs < ingestedFromMs - MISSING_GRACE_MS ||
      toMs > ingestedToMs + MISSING_GRACE_MS;

    return jsonResponse({
      last_ingested_at: lastIngested?.last_ingested_at ?? null,
      ingested_range_utc: {
        from: ingestedFrom,
        to: ingestedTo
      },
      requested_range_utc: {
        from: filters.from,
        to: filters.to
      },
      is_missing_data: isMissing
    });
  } catch (error) {
    return errorResponse(
      error instanceof Error ? error.message : "Failed to load sync status",
      500
    );
  }
};
