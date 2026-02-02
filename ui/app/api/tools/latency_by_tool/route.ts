import { NextRequest } from "next/server";

import { getDb } from "@/lib/server/db";
import { parseFilters } from "@/lib/server/filters";
import { buildToolJoin, buildWhere } from "@/lib/server/query";
import { errorResponse, jsonResponse } from "@/lib/server/response";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const percentile = (values: number[], p: number) => {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.floor((sorted.length - 1) * p);
  return sorted[idx];
};

const summarizeDurations = (rows: Array<{ tool: string; duration_ms: number }>) => {
  const grouped = new Map<string, number[]>();
  for (const row of rows) {
    if (!grouped.has(row.tool)) grouped.set(row.tool, []);
    grouped.get(row.tool)!.push(row.duration_ms);
  }

  return Array.from(grouped.entries())
    .map(([toolName, durations]) => ({
      tool: toolName,
      count: durations.length,
      p50: percentile(durations, 0.5),
      p95: percentile(durations, 0.95)
    }))
    .sort((a, b) => b.count - a.count);
};

export const GET = (request: NextRequest) => {
  try {
    const filters = parseFilters(request.nextUrl.searchParams);
    const db = getDb(request.nextUrl.searchParams);
    const hasModelOrDir = filters.models.length > 0 || filters.dirs.length > 0;

    if (!hasModelOrDir) {
      const appWhere = buildWhere(filters, {
        timeColumn: "completed_at",
        sourceColumn: "source"
      });
      const countRow = db
        .prepare(
          `SELECT COUNT(*) as total\n          FROM app_items ai\n          ${appWhere.sql}\n          AND duration_ms IS NOT NULL`
        )
        .get(appWhere.params) as { total: number } | undefined;

      if (countRow?.total) {
        const rows = db
          .prepare(
            `SELECT COALESCE(tool_name, command_name, item_type, '<unknown>') as tool,\n            duration_ms\n            FROM app_items ai\n            ${appWhere.sql}\n            AND duration_ms IS NOT NULL\n            ORDER BY duration_ms DESC\n            LIMIT 10000`
          )
          .all(appWhere.params) as Array<{ tool: string; duration_ms: number }>;
        const summary = summarizeDurations(rows).slice(0, filters.topN);
        return jsonResponse({ rows: summary, source: "app_items" });
      }
    }

    const tool = buildToolJoin(filters);

    const rows = db
      .prepare(
        `SELECT COALESCE(tool_name, tool_type) as tool,
          call_id,
          (julianday(MAX(tc.captured_at_utc)) - julianday(MIN(tc.captured_at_utc))) * 86400000.0 as duration_ms
        FROM tool_calls tc
        ${tool.join}
        ${tool.where}
        AND call_id IS NOT NULL
        GROUP BY tool, call_id
        HAVING duration_ms IS NOT NULL
        ORDER BY duration_ms DESC
        LIMIT 5000`
      )
      .all(tool.params) as Array<{ tool: string; duration_ms: number }>;

    const summary = summarizeDurations(rows).slice(0, filters.topN);

    return jsonResponse({ rows: summary, source: "tool_calls" });
  } catch (error) {
    return errorResponse(
      error instanceof Error ? error.message : "Failed to load tool latency",
      500
    );
  }
};
