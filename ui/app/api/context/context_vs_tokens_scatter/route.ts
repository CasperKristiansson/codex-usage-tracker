import { NextRequest } from "next/server";

import { getDb } from "@/lib/server/db";
import { parseFilters } from "@/lib/server/filters";
import { applyEventType, buildWhere } from "@/lib/server/query";
import { errorResponse, jsonResponse } from "@/lib/server/response";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = (request: NextRequest) => {
  try {
    const filters = parseFilters(request.nextUrl.searchParams);
    const db = getDb(request.nextUrl.searchParams);
    const base = buildWhere(filters, {
      timeColumn: "captured_at_utc",
      modelColumn: "model",
      dirColumn: "directory",
      sourceColumn: "source"
    });
    const eventsWhere = applyEventType(base, "token_count");

    const maxRow = db
      .prepare(
        `SELECT MAX(total_tokens) as max_tokens
        FROM events
        ${eventsWhere.sql}
        AND total_tokens IS NOT NULL`
      )
      .get(eventsWhere.params) as { max_tokens: number | null } | undefined;

    const maxTokens = maxRow?.max_tokens ?? 0;
    const tokenBinSize = Math.max(100, Math.ceil(maxTokens / 40) || 100);

    const rows = db
      .prepare(
        `SELECT
          CASE
            WHEN context_percent_left < 0 THEN 0
            WHEN context_percent_left > 100 THEN 100
            ELSE CAST(context_percent_left / 5 AS INTEGER) * 5
          END as context_bin,
          CAST(total_tokens / ${tokenBinSize} AS INTEGER) * ${tokenBinSize} as token_bin,
          COUNT(*) as count
        FROM events
        ${eventsWhere.sql}
        AND context_percent_left IS NOT NULL
        AND total_tokens IS NOT NULL
        GROUP BY context_bin, token_bin
        ORDER BY token_bin ASC, context_bin ASC
        LIMIT 2000`
      )
      .all(eventsWhere.params);

    return jsonResponse({
      token_bin_size: tokenBinSize,
      rows
    });
  } catch (error) {
    return errorResponse(
      error instanceof Error ? error.message : "Failed to load context vs tokens",
      500
    );
  }
};
