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
    const db = getDb();
    const tool = buildToolJoin(filters);

    const rows = db
      .prepare(
        `SELECT tool_type, COUNT(*) as count
        FROM tool_calls tc
        ${tool.join}
        ${tool.where}
        GROUP BY tool_type
        ORDER BY count DESC
        LIMIT ${filters.topN}`
      )
      .all(tool.params);

    return jsonResponse({ rows });
  } catch (error) {
    return errorResponse(
      error instanceof Error ? error.message : "Failed to load tool types",
      500
    );
  }
};
