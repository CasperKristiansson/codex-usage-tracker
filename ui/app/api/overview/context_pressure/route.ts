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
    const db = getDb();
    const base = buildWhere(filters, {
      timeColumn: "captured_at_utc",
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

    const danger = db
      .prepare(
        `SELECT
          COUNT(*) as total,
          SUM(CASE WHEN context_percent_left <= 10 THEN 1 ELSE 0 END) as danger
        FROM events
        ${eventsWhere.sql}
        AND context_percent_left IS NOT NULL`
      )
      .get(eventsWhere.params) as { total: number; danger: number } | undefined;

    const dangerRate = danger?.total
      ? (danger.danger / danger.total) * 100
      : null;

    return jsonResponse({
      histogram: rows,
      danger_rate: dangerRate
    });
  } catch (error) {
    return errorResponse(
      error instanceof Error ? error.message : "Failed to load context pressure",
      500
    );
  }
};
