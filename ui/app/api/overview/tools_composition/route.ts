import { NextRequest } from "next/server";

import { getDb } from "@/lib/server/db";
import { parseFilters } from "@/lib/server/filters";
import { buildToolJoin } from "@/lib/server/query";
import { errorResponse, jsonResponse } from "@/lib/server/response";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = (request: NextRequest) => {
  try {
    const filters = parseFilters(request.nextUrl.searchParams);
    const db = getDb(request.nextUrl.searchParams);
    const tool = buildToolJoin(filters);
    const labelExpr = "COALESCE(tool_type, '<unknown>')";

    const rows = db
      .prepare(
        `SELECT ${labelExpr} as tool_type, COUNT(*) as count
        FROM tool_calls tc
        ${tool.join}
        ${tool.where}
        GROUP BY ${labelExpr}
        ORDER BY count DESC
        LIMIT ${filters.topN}`
      )
      .all(tool.params);

    let otherCount: number | null = null;
    if (rows.length) {
      const otherRow = db
        .prepare(
          `SELECT COUNT(*) as count
          FROM tool_calls tc
          ${tool.join}
          ${tool.where}
          AND ${labelExpr} NOT IN (${rows.map(() => "?").join(",")})`
        )
        .get([...tool.params, ...rows.map((row) => row.tool_type)]) as
        | { count: number | null }
        | undefined;
      otherCount = otherRow?.count ?? null;
    }

    return jsonResponse({
      rows,
      other:
        otherCount && otherCount > 0
          ? { tool_type: "Other", count: otherCount }
          : null
    });
  } catch (error) {
    return errorResponse(
      error instanceof Error ? error.message : "Failed to load tools composition",
      500
    );
  }
};
