import { NextRequest } from "next/server";

import { getDb } from "@/lib/server/db";
import { parseFilters } from "@/lib/server/filters";
import { applyEventType, buildWhere } from "@/lib/server/query";
import { errorResponse, jsonResponse } from "@/lib/server/response";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const branchLabel = "COALESCE(NULLIF(trim(s.git_branch), ''), '<unknown>')";

export const GET = (request: NextRequest) => {
  try {
    const filters = parseFilters(request.nextUrl.searchParams);
    const db = getDb(request.nextUrl.searchParams);
    const base = buildWhere(filters, {
      timeColumn: "e.captured_at",
      modelColumn: "e.model",
      dirColumn: "e.directory",
      sourceColumn: "e.source"
    });
    const eventsWhere = applyEventType(base, "token_count");

    const rows = db
      .prepare(
        `SELECT ${branchLabel} as label, SUM(e.total_tokens) as total_tokens
        FROM events e
        LEFT JOIN sessions s ON s.session_id = e.session_id
        ${eventsWhere.sql}
        GROUP BY label
        ORDER BY total_tokens DESC
        LIMIT ${filters.topN}`
      )
      .all(eventsWhere.params) as Array<{ label: string; total_tokens: number }>;

    let otherTotal: number | null = null;
    if (rows.length) {
      const otherRow = db
        .prepare(
          `SELECT SUM(e.total_tokens) as total_tokens
          FROM events e
          LEFT JOIN sessions s ON s.session_id = e.session_id
          ${eventsWhere.sql}
          AND ${branchLabel} NOT IN (${rows.map(() => "?").join(",")})`
        )
        .get([...eventsWhere.params, ...rows.map((row) => row.label)]) as
        | { total_tokens: number | null }
        | undefined;
      otherTotal = otherRow?.total_tokens ?? null;
    }

    return jsonResponse({
      rows,
      other: otherTotal
        ? {
            label: "Other",
            total_tokens: otherTotal
          }
        : null
    });
  } catch (error) {
    return errorResponse(
      error instanceof Error ? error.message : "Failed to load branch top",
      500
    );
  }
};
