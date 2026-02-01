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
      timeColumn: "e.captured_at_utc",
      modelColumn: "e.model",
      dirColumn: "e.directory",
      sourceColumn: "e.source"
    });
    const eventsWhere = applyEventType(base, "token_count");

    const rows = db
      .prepare(
        `SELECT e.session_id, s.cwd, SUM(e.total_tokens) as total_tokens, COUNT(*) as turns
        FROM events e
        LEFT JOIN sessions s ON s.session_id = e.session_id
        ${eventsWhere.sql}
        AND e.session_id IS NOT NULL
        GROUP BY e.session_id
        ORDER BY total_tokens DESC
        LIMIT ${filters.topN}`
      )
      .all(eventsWhere.params);

    return jsonResponse({ rows });
  } catch (error) {
    return errorResponse(
      error instanceof Error ? error.message : "Failed to load top sessions",
      500
    );
  }
};
