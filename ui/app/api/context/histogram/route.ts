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
      timeColumn: "captured_at",
      modelColumn: "model",
      dirColumn: "directory",
      sourceColumn: "source"
    });
    const eventsWhere = applyEventType(base, "token_count");

    const rows = db
      .prepare(
        `SELECT
          CASE
            WHEN context_percent_left < 0 THEN 0
            WHEN context_percent_left > 100 THEN 100
            ELSE CAST(context_percent_left / 5 AS INTEGER) * 5
          END as bin,
          COUNT(*) as count
        FROM events
        ${eventsWhere.sql}
        AND context_percent_left IS NOT NULL
        GROUP BY bin
        ORDER BY bin ASC`
      )
      .all(eventsWhere.params);

    return jsonResponse({ rows });
  } catch (error) {
    return errorResponse(
      error instanceof Error ? error.message : "Failed to load context histogram",
      500
    );
  }
};
