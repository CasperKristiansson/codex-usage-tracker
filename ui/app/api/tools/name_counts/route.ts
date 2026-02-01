import { NextRequest } from "next/server";

import { getDb } from "@/lib/server/db";
import { parseFilters } from "@/lib/server/filters";
import { buildToolJoin } from "@/lib/server/query";
import { errorResponse, jsonResponse } from "@/lib/server/response";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = (request: NextRequest) => {
  try {
    const toolType = request.nextUrl.searchParams.get("tool_type");
    if (!toolType) {
      return errorResponse("tool_type is required", 400);
    }

    const filters = parseFilters(request.nextUrl.searchParams);
    const db = getDb();
    const tool = buildToolJoin(filters);
    const params = [...tool.params, toolType];

    const rows = db
      .prepare(
        `SELECT tool_name, COUNT(*) as count
        FROM tool_calls tc
        ${tool.join}
        ${tool.where}
        AND tc.tool_type = ?
        GROUP BY tool_name
        ORDER BY count DESC
        LIMIT ${filters.topN}`
      )
      .all(params);

    return jsonResponse({ rows });
  } catch (error) {
    return errorResponse(
      error instanceof Error ? error.message : "Failed to load tool names",
      500
    );
  }
};
