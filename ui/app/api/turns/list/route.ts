import { NextRequest } from "next/server";

import { getDb } from "@/lib/server/db";
import { DEFAULT_PAGE, DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE } from "@/lib/server/constants";
import { parseFilters } from "@/lib/server/filters";
import { buildWhere } from "@/lib/server/query";
import { errorResponse, jsonResponse } from "@/lib/server/response";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const clamp = (value: number, min: number, max: number) =>
  Math.min(Math.max(value, min), max);

export const GET = (request: NextRequest) => {
  try {
    const filters = parseFilters(request.nextUrl.searchParams);
    const db = getDb(request.nextUrl.searchParams);

    const pageRaw = Number(request.nextUrl.searchParams.get("page"));
    const sizeRaw = Number(request.nextUrl.searchParams.get("pageSize"));
    const search = request.nextUrl.searchParams.get("q")?.trim();
    const page = Number.isNaN(pageRaw) ? DEFAULT_PAGE : Math.max(pageRaw, 1);
    const pageSize = Number.isNaN(sizeRaw)
      ? DEFAULT_PAGE_SIZE
      : clamp(sizeRaw, 1, MAX_PAGE_SIZE);
    const offset = (page - 1) * pageSize;

    const base = buildWhere(filters, {
      timeColumn: "captured_at",
      modelColumn: "model",
      dirColumn: "cwd",
      sourceColumn: "source"
    });

    let whereSql = base.sql;
    const params = [...base.params];

    if (search) {
      const clause =
        "(session_id LIKE ? OR cwd LIKE ? OR model LIKE ? OR CAST(turn_index AS TEXT) LIKE ?)";
      whereSql = whereSql ? `${whereSql} AND ${clause}` : `WHERE ${clause}`;
      const like = `%${search}%`;
      params.push(like, like, like, like);
    }

    const totalRow = db
      .prepare(`SELECT COUNT(*) as total FROM turns ${whereSql}`)
      .get(params) as { total: number } | undefined;

    const rows = db
      .prepare(
        `SELECT captured_at_utc, session_id, turn_index, model, cwd
        FROM turns
        ${whereSql}
        ORDER BY captured_at_utc DESC
        LIMIT ${pageSize} OFFSET ${offset}`
      )
      .all(params);

    return jsonResponse({
      page,
      page_size: pageSize,
      total: totalRow?.total ?? 0,
      rows
    });
  } catch (error) {
    return errorResponse(
      error instanceof Error ? error.message : "Failed to load turns",
      500
    );
  }
};
