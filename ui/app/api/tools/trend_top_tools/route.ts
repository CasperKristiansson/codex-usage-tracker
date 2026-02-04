import { NextRequest } from "next/server";

import { getDb } from "@/lib/server/db";
import { parseFilters } from "@/lib/server/filters";
import { bucketExpression, buildToolJoin, limitBuckets } from "@/lib/server/query";
import { errorResponse, jsonResponse } from "@/lib/server/response";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = (request: NextRequest) => {
  try {
    const filters = parseFilters(request.nextUrl.searchParams);
    const db = getDb(request.nextUrl.searchParams);
    const tool = buildToolJoin(filters);
    const labelExpr = "COALESCE(tc.tool_name, tc.tool_type, '<unknown>')";

    const topRows = db
      .prepare(
        `SELECT ${labelExpr} as tool, COUNT(*) as count
        FROM tool_calls tc
        ${tool.join}
        ${tool.where}
        GROUP BY tool
        ORDER BY count DESC
        LIMIT ${filters.topN}`
      )
      .all(tool.params) as Array<{ tool: string }>;

    const tools = topRows.map((row) => row.tool).filter(Boolean);
    if (!tools.length) {
      return jsonResponse({ bucket: filters.resolvedBucket, rows: [] });
    }

    const bucketExpr = bucketExpression(filters.resolvedBucket, "tc.captured_at");

    const rows = db
      .prepare(
        `SELECT ${bucketExpr} as bucket, ${labelExpr} as tool, COUNT(*) as count
        FROM tool_calls tc
        ${tool.join}
        ${tool.where}
        AND ${labelExpr} IN (${tools.map(() => "?").join(",")})
        GROUP BY bucket, tool
        ORDER BY bucket ASC`
      )
      .all([...tool.params, ...tools]) as Array<Record<string, unknown>>;

    const otherRows = db
      .prepare(
        `SELECT ${bucketExpr} as bucket, COUNT(*) as count
        FROM tool_calls tc
        ${tool.join}
        ${tool.where}
        AND ${labelExpr} NOT IN (${tools.map(() => "?").join(",")})
        GROUP BY bucket
        ORDER BY bucket ASC`
      )
      .all([...tool.params, ...tools]) as Array<{ bucket: string; count: number }>;

    const combinedRows = [
      ...rows,
      ...otherRows.map((row) => ({ bucket: row.bucket, tool: "Other", count: row.count }))
    ];

    return jsonResponse({
      bucket: filters.resolvedBucket,
      rows: limitBuckets(combinedRows)
    });
  } catch (error) {
    return errorResponse(
      error instanceof Error ? error.message : "Failed to load tool trends",
      500
    );
  }
};
