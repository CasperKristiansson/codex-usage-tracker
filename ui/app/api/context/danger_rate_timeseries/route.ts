import { NextRequest } from "next/server";

import { getDb } from "@/lib/server/db";
import { parseFilters } from "@/lib/server/filters";
import { applyEventType, bucketExpression, buildWhere, clampBuckets } from "@/lib/server/query";
import { errorResponse, jsonResponse } from "@/lib/server/response";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = (request: NextRequest) => {
  try {
    const filters = parseFilters(request.nextUrl.searchParams);
    const db = getDb();
    const bucketExpr = bucketExpression(filters.resolvedBucket);
    const base = buildWhere(filters, {
      timeColumn: "captured_at_utc",
      modelColumn: "model",
      dirColumn: "directory",
      sourceColumn: "source"
    });
    const eventsWhere = applyEventType(base, "token_count");

    const rows = db
      .prepare(
        `SELECT ${bucketExpr} as bucket,
          COUNT(*) as total,
          SUM(CASE WHEN context_percent_left <= 10 THEN 1 ELSE 0 END) as danger
        FROM events
        ${eventsWhere.sql}
        AND context_percent_left IS NOT NULL
        GROUP BY bucket
        ORDER BY bucket ASC`
      )
      .all(eventsWhere.params) as Array<{
      bucket: string;
      total: number;
      danger: number;
    }>;

    const mapped = rows.map((row) => ({
      bucket: row.bucket,
      danger_rate: row.total ? (row.danger / row.total) * 100 : null,
      total: row.total
    }));

    return jsonResponse({
      bucket: filters.resolvedBucket,
      rows: clampBuckets(mapped)
    });
  } catch (error) {
    return errorResponse(
      error instanceof Error ? error.message : "Failed to load danger rate",
      500
    );
  }
};
