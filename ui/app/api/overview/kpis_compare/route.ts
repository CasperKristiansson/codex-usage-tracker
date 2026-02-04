import { NextRequest } from "next/server";

import { getDb } from "@/lib/server/db";
import {
  getPreviousRange,
  parseFilters,
  type NormalizedFilters
} from "@/lib/server/filters";
import { applyEventType, buildToolJoin, buildWhere } from "@/lib/server/query";
import { errorResponse, jsonResponse } from "@/lib/server/response";
import { estimateCost, type PricingConfig } from "@/lib/pricing";
import { loadPricingSettings } from "@/lib/server/pricing";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const errorCase =
  "SUM(CASE WHEN status IS NOT NULL AND (lower(status) LIKE '%error%' OR lower(status) = 'failed') THEN 1 ELSE 0 END)";

const loadKpis = (
  filters: NormalizedFilters,
  db: ReturnType<typeof getDb>,
  pricing: PricingConfig
) => {
  const base = buildWhere(filters, {
    timeColumn: "captured_at",
    modelColumn: "model",
    dirColumn: "directory",
    sourceColumn: "source"
  });
  const eventsWhere = applyEventType(base, "token_count");

  const tokenRow = db
    .prepare(
      `SELECT
        SUM(total_tokens) as total_tokens,
        SUM(input_tokens) as input_tokens,
        SUM(output_tokens) as output_tokens,
        SUM(reasoning_output_tokens) as reasoning_tokens,
        SUM(cached_input_tokens) as cached_input_tokens,
        SUM(COALESCE(input_tokens, 0) + COALESCE(cached_input_tokens, 0)) as input_total
      FROM events
      ${eventsWhere.sql}`
    )
    .get(eventsWhere.params) as {
    total_tokens: number | null;
    input_tokens: number | null;
    output_tokens: number | null;
    reasoning_tokens: number | null;
    cached_input_tokens: number | null;
    input_total: number | null;
  };

  const tool = buildToolJoin(filters);
  const toolRow = db
    .prepare(
      `SELECT COUNT(*) as total, ${errorCase} as errors
      FROM tool_calls tc
      ${tool.join}
      ${tool.where}`
    )
    .get(tool.params) as { total: number; errors: number };

  const costRows = db
    .prepare(
      `SELECT model,
        SUM(input_tokens) as input_tokens,
        SUM(cached_input_tokens) as cached_input_tokens,
        SUM(output_tokens) as output_tokens,
        SUM(total_tokens) as total_tokens
      FROM events
      ${eventsWhere.sql}
      GROUP BY model`
    )
    .all(eventsWhere.params) as Array<{
    model: string | null;
    input_tokens: number | null;
    cached_input_tokens: number | null;
    output_tokens: number | null;
    total_tokens: number | null;
  }>;

  let estimatedCost = 0;
  let pricedTokens = 0;
  costRows.forEach((row) => {
    const cost = estimateCost(row, pricing);
    if (cost === null) return;
    estimatedCost += cost;
    pricedTokens += row.total_tokens ?? 0;
  });

  const cacheShare = tokenRow?.input_total
    ? ((tokenRow.cached_input_tokens ?? 0) / tokenRow.input_total) * 100
    : null;
  const errorRate = toolRow?.total ? (toolRow.errors / toolRow.total) * 100 : null;
  const totalTokens = tokenRow?.total_tokens ?? 0;
  const costCoverage = totalTokens ? (pricedTokens / totalTokens) * 100 : null;

  return {
    total_tokens: tokenRow.total_tokens ?? 0,
    input_tokens: tokenRow.input_tokens ?? 0,
    output_tokens: tokenRow.output_tokens ?? 0,
    reasoning_tokens: tokenRow.reasoning_tokens ?? 0,
    cached_input_tokens: tokenRow.cached_input_tokens ?? 0,
    cache_share: cacheShare,
    tool_calls: toolRow.total ?? 0,
    tool_error_rate: errorRate,
    estimated_cost: estimatedCost,
    cost_coverage: costCoverage
  };
};

export const GET = (request: NextRequest) => {
  try {
    const filters = parseFilters(request.nextUrl.searchParams);
    const db = getDb(request.nextUrl.searchParams);
    const { pricing } = loadPricingSettings(request.nextUrl.searchParams);

    const current = loadKpis(filters, db, pricing);
    const previousRange = getPreviousRange(filters);
    const previous = previousRange
      ? loadKpis({ ...filters, from: previousRange.from, to: previousRange.to }, db, pricing)
      : null;

    return jsonResponse({
      current,
      previous,
      range: { from: filters.from, to: filters.to },
      previous_range: previousRange
    });
  } catch (error) {
    return errorResponse(
      error instanceof Error ? error.message : "Failed to load KPI comparison",
      500
    );
  }
};
