import { NextRequest } from "next/server";

import { getDb } from "@/lib/server/db";
import { parseFilters } from "@/lib/server/filters";
import { applyEventType, buildWhere } from "@/lib/server/query";
import { errorResponse, jsonResponse } from "@/lib/server/response";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const buildDirectoryLabel = (depth: number) => {
  const clean = "ltrim(directory, '/')";
  if (depth === 1) {
    return `CASE
      WHEN directory IS NULL THEN '<unknown>'
      ELSE '/' || CASE
        WHEN instr(${clean}, '/') = 0 THEN ${clean}
        ELSE substr(${clean}, 1, instr(${clean}, '/') - 1)
      END
    END`;
  }

  if (depth === 2) {
    return `CASE
      WHEN directory IS NULL THEN '<unknown>'
      ELSE '/' || CASE
        WHEN instr(${clean}, '/') = 0 THEN ${clean}
        WHEN instr(substr(${clean}, instr(${clean}, '/') + 1), '/') = 0 THEN ${clean}
        ELSE substr(
          ${clean},
          1,
          instr(${clean}, '/') + instr(substr(${clean}, instr(${clean}, '/') + 1), '/') - 1
        )
      END
    END`;
  }

  return "COALESCE(directory, '<unknown>')";
};

export const GET = (request: NextRequest) => {
  try {
    const filters = parseFilters(request.nextUrl.searchParams);
    const depth = Number(request.nextUrl.searchParams.get("depth") ?? 0);
    const db = getDb();
    const base = buildWhere(filters, {
      timeColumn: "captured_at_utc",
      modelColumn: "model",
      dirColumn: "directory",
      sourceColumn: "source"
    });
    const eventsWhere = applyEventType(base, "token_count");
    const labelExpr = buildDirectoryLabel(depth === 1 || depth === 2 ? depth : 0);

    const rows = db
      .prepare(
        `SELECT ${labelExpr} as label, SUM(total_tokens) as total_tokens
        FROM events
        ${eventsWhere.sql}
        GROUP BY label
        ORDER BY total_tokens DESC
        LIMIT ${filters.topN}`
      )
      .all(eventsWhere.params) as Array<{ label: string; total_tokens: number }>;

    let otherTotal: number | null = null;
    if (rows.length) {
      const otherRow = db
        .prepare(
          `SELECT SUM(total_tokens) as total_tokens
          FROM events
          ${eventsWhere.sql}
          AND ${labelExpr} NOT IN (${rows
            .map(() => "?")
            .join(",")})`
        )
        .get([...eventsWhere.params, ...rows.map((row) => row.label)]) as
        | { total_tokens: number | null }
        | undefined;
      otherTotal = otherRow?.total_tokens ?? null;
    }

    return jsonResponse({
      rows: rows,
      other: otherTotal
        ? {
            label: "Other",
            total_tokens: otherTotal
          }
        : null
    });
  } catch (error) {
    return errorResponse(
      error instanceof Error ? error.message : "Failed to load directory top",
      500
    );
  }
};
