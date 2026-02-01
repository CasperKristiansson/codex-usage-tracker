import { NextRequest } from "next/server";

import { getDb } from "@/lib/server/db";
import { parseFilters } from "@/lib/server/filters";
import { bucketExpression, buildWhere, limitBuckets } from "@/lib/server/query";
import { errorResponse, jsonResponse } from "@/lib/server/response";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const EVENT_TYPES = [
  "context_compacted",
  "thread_rolled_back",
  "undo_completed",
  "turn_aborted",
  "entered_review_mode",
  "exited_review_mode"
];

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

    const rows = db
      .prepare(
        `SELECT ${bucketExpr} as bucket, event_type, COUNT(*) as count
        FROM events
        ${base.sql}
        AND event_type IN (${EVENT_TYPES.map(() => "?").join(",")})
        GROUP BY bucket, event_type
        ORDER BY bucket ASC`
      )
      .all([...base.params, ...EVENT_TYPES]) as Array<Record<string, unknown>>;

    return jsonResponse({
      bucket: filters.resolvedBucket,
      rows: limitBuckets(rows)
    });
  } catch (error) {
    return errorResponse(
      error instanceof Error ? error.message : "Failed to load friction events",
      500
    );
  }
};
