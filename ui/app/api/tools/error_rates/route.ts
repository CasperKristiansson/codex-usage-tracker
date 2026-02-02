import { NextRequest } from "next/server";

import { getDb } from "@/lib/server/db";
import { parseFilters } from "@/lib/server/filters";
import { buildToolJoin } from "@/lib/server/query";
import { errorResponse, jsonResponse } from "@/lib/server/response";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const errorCase =
  "SUM(CASE WHEN status IS NOT NULL AND (lower(status) LIKE '%error%' OR lower(status) = 'failed') THEN 1 ELSE 0 END)";

export const GET = (request: NextRequest) => {
  try {
    const filters = parseFilters(request.nextUrl.searchParams);
    const db = getDb(request.nextUrl.searchParams);
    const tool = buildToolJoin(filters);

    const rows = (
      db
      .prepare(
        `SELECT COALESCE(tool_name, tool_type) as tool, COUNT(*) as total, ${errorCase} as errors
        FROM tool_calls tc
        ${tool.join}
        ${tool.where}
        GROUP BY tool
        ORDER BY total DESC
        LIMIT ${filters.topN}`
      )
      .all(tool.params) as Array<{ tool: string; total: number; errors: number }>
    ).map((row) => ({
        tool: row.tool,
        total: row.total,
        errors: row.errors,
        error_rate: row.total ? (row.errors / row.total) * 100 : null
      }));

    return jsonResponse({ rows });
  } catch (error) {
    return errorResponse(
      error instanceof Error ? error.message : "Failed to load tool error rates",
      500
    );
  }
};
