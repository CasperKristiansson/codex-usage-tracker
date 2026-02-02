import { NextRequest } from "next/server";

import { getDb } from "@/lib/server/db";
import { parseFilters } from "@/lib/server/filters";
import { applyEventType, buildWhere } from "@/lib/server/query";
import { errorResponse, jsonResponse } from "@/lib/server/response";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = (request: NextRequest) => {
  try {
    const filters = parseFilters(request.nextUrl.searchParams);
    const db = getDb(request.nextUrl.searchParams);
    const base = buildWhere(filters, {
      timeColumn: "captured_at_utc",
      modelColumn: "model",
      dirColumn: "directory",
      sourceColumn: "source"
    });
    const eventsWhere = applyEventType(base, "token_count");

    const maxRow = db
      .prepare(
        `SELECT MAX(total_tokens) as max_tokens
        FROM events
        ${eventsWhere.sql}
        AND total_tokens IS NOT NULL`
      )
      .get(eventsWhere.params) as { max_tokens: number | null } | undefined;

    const maxTokens = maxRow?.max_tokens ?? 0;
    const binSize = Math.max(50, Math.ceil(maxTokens / 40) || 50);

    const rows = (
      db
      .prepare(
        `SELECT CAST(total_tokens / ${binSize} AS INTEGER) * ${binSize} as bin,
          COUNT(*) as count
        FROM events
        ${eventsWhere.sql}
        AND total_tokens IS NOT NULL
        GROUP BY bin
        ORDER BY bin ASC`
      )
      .all(eventsWhere.params) as Array<{ bin: number; count: number }>
    ).map((row) => ({
        start: row.bin,
        end: row.bin + binSize,
        count: row.count
      }));

    return jsonResponse({
      bin_size: binSize,
      rows
    });
  } catch (error) {
    return errorResponse(
      error instanceof Error ? error.message : "Failed to load token distribution",
      500
    );
  }
};
