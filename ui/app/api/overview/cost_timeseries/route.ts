import { NextRequest } from "next/server";

import { getDb } from "@/lib/server/db";
import { parseFilters } from "@/lib/server/filters";
import { applyEventType, bucketExpression, buildWhere, limitBuckets } from "@/lib/server/query";
import { errorResponse, jsonResponse } from "@/lib/server/response";
import { estimateCost } from "@/lib/pricing";
import { loadPricingSettings } from "@/lib/server/pricing";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = (request: NextRequest) => {
  try {
    const filters = parseFilters(request.nextUrl.searchParams);
    const db = getDb(request.nextUrl.searchParams);
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
        `SELECT ${bucketExpr} as bucket, model,
          SUM(input_tokens) as input_tokens,
          SUM(cached_input_tokens) as cached_input_tokens,
          SUM(output_tokens) as output_tokens,
          SUM(total_tokens) as total_tokens
        FROM events
        ${eventsWhere.sql}
        GROUP BY bucket, model
        ORDER BY bucket ASC`
      )
      .all(eventsWhere.params) as Array<{
      bucket: string;
      model: string | null;
      input_tokens: number | null;
      cached_input_tokens: number | null;
      output_tokens: number | null;
      total_tokens: number | null;
    }>;

    const bucketed = limitBuckets(rows.map((row) => ({ bucket: row.bucket })));
    const bucketSet = new Set(bucketed.map((row) => row.bucket as string));
    const filtered = rows.filter((row) => bucketSet.has(row.bucket));

    const bucketTotals = new Map<string, { cost: number; priced: number; total: number }>();
    const { pricing } = loadPricingSettings(request.nextUrl.searchParams);

    filtered.forEach((row) => {
      const bucket = row.bucket;
      if (!bucketTotals.has(bucket)) {
        bucketTotals.set(bucket, { cost: 0, priced: 0, total: 0 });
      }
      const entry = bucketTotals.get(bucket)!;
      entry.total += row.total_tokens ?? 0;
      const cost = estimateCost(row, pricing);
      if (cost !== null) {
        entry.cost += cost;
        entry.priced += row.total_tokens ?? 0;
      }
    });

    const outputRows = Array.from(bucketTotals.entries())
      .map(([bucket, entry]) => ({
        bucket,
        estimated_cost: entry.cost,
        cost_coverage: entry.total ? (entry.priced / entry.total) * 100 : null
      }))
      .sort((a, b) => a.bucket.localeCompare(b.bucket));

    return jsonResponse({
      bucket: filters.resolvedBucket,
      rows: outputRows
    });
  } catch (error) {
    return errorResponse(
      error instanceof Error ? error.message : "Failed to load cost timeseries",
      500
    );
  }
};
