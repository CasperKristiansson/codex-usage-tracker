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
    const db = getDb(request.nextUrl.searchParams);
    const tool = buildToolJoin(filters);
    const params = [...tool.params, toolType];
    const labelExpr = "COALESCE(tc.tool_name, '<unknown>')";

    const rows = db
      .prepare(
        `SELECT ${labelExpr} as tool_name, COUNT(*) as count
        FROM tool_calls tc
        ${tool.join}
        ${tool.where}
        AND tc.tool_type = ?
        GROUP BY ${labelExpr}
        ORDER BY count DESC
        LIMIT ${filters.topN}`
      )
      .all(params);

    let otherCount: number | null = null;
    if (rows.length) {
      const otherRow = db
        .prepare(
          `SELECT COUNT(*) as count
          FROM tool_calls tc
          ${tool.join}
          ${tool.where}
          AND tc.tool_type = ?
          AND ${labelExpr} NOT IN (${rows.map(() => "?").join(",")})`
        )
        .get([...params, ...rows.map((row) => row.tool_name)]) as
        | { count: number | null }
        | undefined;
      otherCount = otherRow?.count ?? null;
    }

    return jsonResponse({
      rows,
      other:
        otherCount && otherCount > 0
          ? { tool_name: "Other", count: otherCount }
          : null
    });
  } catch (error) {
    return errorResponse(
      error instanceof Error ? error.message : "Failed to load tool names",
      500
    );
  }
};
