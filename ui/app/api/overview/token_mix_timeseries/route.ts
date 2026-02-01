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
          SUM(input_tokens) as input_tokens,
          SUM(cached_input_tokens) as cached_input_tokens,
          SUM(output_tokens) as output_tokens,
          SUM(reasoning_output_tokens) as reasoning_tokens
        FROM events
        ${eventsWhere.sql}
        GROUP BY bucket
        ORDER BY bucket ASC`
      )
      .all(eventsWhere.params) as Array<Record<string, unknown>>;

    return jsonResponse({
      bucket: filters.resolvedBucket,
      rows: clampBuckets(rows)
    });
  } catch (error) {
    return errorResponse(
      error instanceof Error ? error.message : "Failed to load token mix",
      500
    );
  }
};
