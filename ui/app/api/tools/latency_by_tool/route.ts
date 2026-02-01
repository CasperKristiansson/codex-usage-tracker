import { NextRequest } from "next/server";

import { getDb } from "@/lib/server/db";
import { parseFilters } from "@/lib/server/filters";
import { buildToolJoin } from "@/lib/server/query";
import { errorResponse, jsonResponse } from "@/lib/server/response";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const percentile = (values: number[], p: number) => {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.floor((sorted.length - 1) * p);
  return sorted[idx];
};

export const GET = (request: NextRequest) => {
  try {
    const filters = parseFilters(request.nextUrl.searchParams);
    const db = getDb();
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

    const grouped = new Map<string, number[]>();
    for (const row of rows) {
      if (!grouped.has(row.tool)) grouped.set(row.tool, []);
      grouped.get(row.tool)!.push(row.duration_ms);
    }

    const summary = Array.from(grouped.entries())
      .map(([toolName, durations]) => ({
        tool: toolName,
        count: durations.length,
        p50: percentile(durations, 0.5),
        p95: percentile(durations, 0.95)
      }))
      .sort((a, b) => b.count - a.count)
      .slice(0, filters.topN);

    return jsonResponse({ rows: summary });
  } catch (error) {
    return errorResponse(
      error instanceof Error ? error.message : "Failed to load tool latency",
      500
    );
  }
};
