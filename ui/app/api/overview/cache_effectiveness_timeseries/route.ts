import { NextRequest } from "next/server";

import { getDb } from "@/lib/server/db";
import { parseFilters } from "@/lib/server/filters";
import { applyEventType, bucketExpression, buildWhere, clampBuckets } from "@/lib/server/query";
import { errorResponse, jsonResponse } from "@/lib/server/response";
import { loadPricingSettings } from "@/lib/server/pricing";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type BucketRow = {
  bucket: string;
  input_tokens: number;
  cached_input_tokens: number;
  estimated_savings: number;
};

export const GET = (request: NextRequest) => {
  try {
    const filters = parseFilters(request.nextUrl.searchParams);
    const db = getDb(request.nextUrl.searchParams);
    const bucketExpr = bucketExpression(filters.resolvedBucket);
    const base = buildWhere(filters, {
      timeColumn: "captured_at",
      modelColumn: "model",
      dirColumn: "directory",
      sourceColumn: "source"
    });
    const eventsWhere = applyEventType(base, "token_count");
    const { pricing } = loadPricingSettings(request.nextUrl.searchParams);

    const rows = db
      .prepare(
        `SELECT ${bucketExpr} as bucket,
          model,
          SUM(input_tokens) as input_tokens,
          SUM(cached_input_tokens) as cached_input_tokens
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
    }>;

    const byBucket = new Map<string, BucketRow>();

    rows.forEach((row) => {
      const bucket = row.bucket;
      if (!bucket) return;
      const inputTokens = Number(row.input_tokens ?? 0);
      const cachedTokens = Number(row.cached_input_tokens ?? 0);
      const entry = byBucket.get(bucket) ?? {
        bucket,
        input_tokens: 0,
        cached_input_tokens: 0,
        estimated_savings: 0
      };
      entry.input_tokens += inputTokens;
      entry.cached_input_tokens += cachedTokens;

      const model = row.model ?? "";
      const rates = pricing.models[model];
      if (rates && cachedTokens > 0) {
        const diff = rates.input_rate - rates.cached_input_rate;
        if (diff > 0) {
          entry.estimated_savings += (cachedTokens * diff) / pricing.per_unit;
        }
      }

      byBucket.set(bucket, entry);
    });

    const aggregated = Array.from(byBucket.values())
      .sort((a, b) => a.bucket.localeCompare(b.bucket))
      .map((entry) => {
        const totalInput = entry.input_tokens + entry.cached_input_tokens;
        return {
          ...entry,
          cache_share: totalInput ? (entry.cached_input_tokens / totalInput) * 100 : 0
        };
      });

    return jsonResponse({
      bucket: filters.resolvedBucket,
      rows: clampBuckets(aggregated)
    });
  } catch (error) {
    return errorResponse(
      error instanceof Error ? error.message : "Failed to load cache effectiveness",
      500
    );
  }
};
