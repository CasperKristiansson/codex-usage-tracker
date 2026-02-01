import { NextRequest } from "next/server";

import { getDb } from "@/lib/server/db";
import { DEFAULT_PAGE, DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE } from "@/lib/server/constants";
import { parseFilters } from "@/lib/server/filters";
import { applyEventType, buildWhere } from "@/lib/server/query";
import { errorResponse, jsonResponse } from "@/lib/server/response";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const clamp = (value: number, min: number, max: number) =>
  Math.min(Math.max(value, min), max);

export const GET = (request: NextRequest) => {
  try {
    const filters = parseFilters(request.nextUrl.searchParams);
    const db = getDb();

    const pageRaw = Number(request.nextUrl.searchParams.get("page"));
    const sizeRaw = Number(request.nextUrl.searchParams.get("pageSize"));
    const page = Number.isNaN(pageRaw) ? DEFAULT_PAGE : Math.max(pageRaw, 1);
    const pageSize = Number.isNaN(sizeRaw)
      ? DEFAULT_PAGE_SIZE
      : clamp(sizeRaw, 1, MAX_PAGE_SIZE);
    const offset = (page - 1) * pageSize;

    const base = buildWhere(filters, {
      timeColumn: "e.captured_at_utc",
      modelColumn: "e.model",
      dirColumn: "e.directory",
      sourceColumn: "e.source"
    });
    const eventsWhere = applyEventType(base, "token_count");

    const totalRow = db
      .prepare(
        `SELECT COUNT(DISTINCT session_id) as total
        FROM events
        ${eventsWhere.sql}
        AND session_id IS NOT NULL`
      )
      .get(eventsWhere.params) as { total: number } | undefined;

    const rows = db
      .prepare(
        `SELECT e.session_id, s.cwd, s.cli_version, MAX(e.captured_at_utc) as last_seen,
          SUM(e.total_tokens) as total_tokens, COUNT(*) as turns
        FROM events e
        LEFT JOIN sessions s ON s.session_id = e.session_id
        ${eventsWhere.sql}
        AND e.session_id IS NOT NULL
        GROUP BY e.session_id
        ORDER BY total_tokens DESC
        LIMIT ${pageSize} OFFSET ${offset}`
      )
      .all(eventsWhere.params);

    return jsonResponse({
      page,
      page_size: pageSize,
      total: totalRow?.total ?? 0,
      rows
    });
  } catch (error) {
    return errorResponse(
      error instanceof Error ? error.message : "Failed to load sessions",
      500
    );
  }
};
