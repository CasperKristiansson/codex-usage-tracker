import { NextRequest } from "next/server";

import { getDb } from "@/lib/server/db";
import { parseFilters } from "@/lib/server/filters";
import { applyEventType, buildWhere } from "@/lib/server/query";
import { errorResponse, jsonResponse } from "@/lib/server/response";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const LIMIT = 200;

export const GET = (request: NextRequest) => {
  try {
    const filters = parseFilters(request.nextUrl.searchParams);
    const db = getDb(request.nextUrl.searchParams);

    const modelFilters = { ...filters, models: [] };
    const modelWhere = applyEventType(
      buildWhere(modelFilters, {
        timeColumn: "captured_at",
        modelColumn: "model",
        dirColumn: "directory",
        sourceColumn: "source"
      }),
      "token_count"
    );
    const models = db
      .prepare(
        `SELECT model as value, COUNT(*) as count
        FROM events
        ${modelWhere.sql}
        AND model IS NOT NULL
        GROUP BY model
        ORDER BY count DESC
        LIMIT ${LIMIT}`
      )
      .all(modelWhere.params) as Array<{ value: string }>;

    const dirFilters = { ...filters, dirs: [] };
    const dirWhere = applyEventType(
      buildWhere(dirFilters, {
        timeColumn: "captured_at",
        modelColumn: "model",
        dirColumn: "directory",
        sourceColumn: "source"
      }),
      "token_count"
    );
    const directories = db
      .prepare(
        `SELECT directory as value, COUNT(*) as count
        FROM events
        ${dirWhere.sql}
        AND directory IS NOT NULL
        GROUP BY directory
        ORDER BY count DESC
        LIMIT ${LIMIT}`
      )
      .all(dirWhere.params) as Array<{ value: string }>;

    const sourceFilters = { ...filters, source: [] };
    const sourceWhere = applyEventType(
      buildWhere(sourceFilters, {
        timeColumn: "captured_at",
        modelColumn: "model",
        dirColumn: "directory",
        sourceColumn: "source"
      }),
      "token_count"
    );
    const sources = db
      .prepare(
        `SELECT source as value, COUNT(*) as count
        FROM events
        ${sourceWhere.sql}
        AND source IS NOT NULL
        GROUP BY source
        ORDER BY count DESC
        LIMIT ${LIMIT}`
      )
      .all(sourceWhere.params) as Array<{ value: string }>;

    return jsonResponse({
      models: models.map((row) => row.value),
      directories: directories.map((row) => row.value),
      sources: sources.map((row) => row.value)
    });
  } catch (error) {
    return errorResponse(
      error instanceof Error ? error.message : "Failed to load filter options",
      500
    );
  }
};
