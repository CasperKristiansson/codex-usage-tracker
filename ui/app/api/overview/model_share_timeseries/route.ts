import { NextRequest } from "next/server";

import { getDb } from "@/lib/server/db";
import { parseFilters } from "@/lib/server/filters";
import {
  applyEventType,
  bucketExpression,
  buildWhere,
  limitBuckets
} from "@/lib/server/query";
import { errorResponse, jsonResponse } from "@/lib/server/response";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const resolveTopModels = (
  db: ReturnType<typeof getDb>,
  whereSql: string,
  params: Array<string | number>,
  topN: number
) => {
  const rows = db
    .prepare(
      `SELECT model, SUM(total_tokens) as total
      FROM events
      ${whereSql}
      GROUP BY model
      ORDER BY total DESC
      LIMIT ${topN}`
    )
    .all(params) as Array<{ model: string }>;
  return rows.map((row) => row.model).filter(Boolean);
};

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

    const topModels = filters.models.length
      ? filters.models.slice(0, filters.topN)
      : resolveTopModels(db, eventsWhere.sql, eventsWhere.params, filters.topN);

    if (!topModels.length) {
      return jsonResponse({
        bucket: filters.resolvedBucket,
        series: [],
        summary: { rows: [], total_tokens: 0, total_turns: 0 }
      });
    }

    const totalsRow = db
      .prepare(
        `SELECT SUM(total_tokens) as total_tokens, COUNT(*) as turns
        FROM events
        ${eventsWhere.sql}`
      )
      .get(eventsWhere.params) as { total_tokens: number | null; turns: number } | undefined;

    const summaryRows = db
      .prepare(
        `SELECT model, SUM(total_tokens) as total_tokens, COUNT(*) as turns
        FROM events
        ${eventsWhere.sql}
        AND model IN (${topModels.map(() => "?").join(",")})
        GROUP BY model
        ORDER BY total_tokens DESC`
      )
      .all([...eventsWhere.params, ...topModels]) as Array<{
      model: string;
      total_tokens: number;
      turns: number;
    }>;

    const seriesRows = db
      .prepare(
        `SELECT ${bucketExpr} as bucket, model, SUM(total_tokens) as total_tokens
        FROM events
        ${eventsWhere.sql}
        AND model IN (${topModels.map(() => "?").join(",")})
        GROUP BY bucket, model
        ORDER BY bucket ASC`
      )
      .all([...eventsWhere.params, ...topModels]) as Array<{
      bucket: string;
      model: string;
      total_tokens: number;
    }>;

    const otherRows = db
      .prepare(
        `SELECT ${bucketExpr} as bucket, SUM(total_tokens) as total_tokens
        FROM events
        ${eventsWhere.sql}
        AND model NOT IN (${topModels.map(() => "?").join(",")})
        GROUP BY bucket
        ORDER BY bucket ASC`
      )
      .all([...eventsWhere.params, ...topModels]) as Array<{
      bucket: string;
      total_tokens: number;
    }>;

    const bucketed = limitBuckets([
      ...seriesRows.map((row) => ({ bucket: row.bucket })),
      ...otherRows.map((row) => ({ bucket: row.bucket }))
    ]);
    const bucketSet = new Set(bucketed.map((row) => row.bucket as string));
    const filteredSeriesRows = seriesRows.filter((row) =>
      bucketSet.has(row.bucket)
    );
    const filteredOtherRows = otherRows.filter((row) =>
      bucketSet.has(row.bucket)
    );

    const series: Record<string, Array<{ bucket: string; value: number }>> = {};
    for (const row of filteredSeriesRows) {
      if (!series[row.model]) series[row.model] = [];
      series[row.model].push({ bucket: row.bucket, value: row.total_tokens });
    }
    if (filteredOtherRows.length) {
      series.Other = filteredOtherRows.map((row) => ({
        bucket: row.bucket,
        value: row.total_tokens
      }));
    }

    return jsonResponse({
      bucket: filters.resolvedBucket,
      series,
      summary: {
        rows: summaryRows,
        total_tokens: totalsRow?.total_tokens ?? 0,
        total_turns: totalsRow?.turns ?? 0
      }
    });
  } catch (error) {
    return errorResponse(
      error instanceof Error ? error.message : "Failed to load model share",
      500
    );
  }
};
