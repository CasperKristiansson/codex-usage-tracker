import { NextRequest } from "next/server";

import { getDb } from "@/lib/server/db";
import { DEFAULT_PAGE, DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE } from "@/lib/server/constants";
import { parseFilters } from "@/lib/server/filters";
import { applyEventType, buildWhere } from "@/lib/server/query";
import { ensureSessionAnnotationTables } from "@/lib/server/session-annotations";
import { errorResponse, jsonResponse } from "@/lib/server/response";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const clamp = (value: number, min: number, max: number) =>
  Math.min(Math.max(value, min), max);

export const GET = (request: NextRequest) => {
  try {
    const filters = parseFilters(request.nextUrl.searchParams);
    const db = getDb(request.nextUrl.searchParams);
    ensureSessionAnnotationTables(db);

    const pageRaw = Number(request.nextUrl.searchParams.get("page"));
    const sizeRaw = Number(request.nextUrl.searchParams.get("pageSize"));
    const search = request.nextUrl.searchParams.get("q")?.trim();
    const minTokensRaw = Number(request.nextUrl.searchParams.get("min_tokens"));
    const minTurnsRaw = Number(request.nextUrl.searchParams.get("min_turns"));
    const minTokensPerTurnRaw = Number(
      request.nextUrl.searchParams.get("min_tokens_per_turn")
    );
    const page = Number.isNaN(pageRaw) ? DEFAULT_PAGE : Math.max(pageRaw, 1);
    const pageSize = Number.isNaN(sizeRaw)
      ? DEFAULT_PAGE_SIZE
      : clamp(sizeRaw, 1, MAX_PAGE_SIZE);
    const offset = (page - 1) * pageSize;

    const base = buildWhere(filters, {
      timeColumn: "e.captured_at",
      modelColumn: "e.model",
      dirColumn: "e.directory",
      sourceColumn: "e.source"
    });
    const eventsWhere = applyEventType(base, "token_count");

    let whereSql = eventsWhere.sql;
    const whereParams = [...eventsWhere.params];

    if (search) {
      whereSql = `${whereSql} AND (e.session_id LIKE ? OR s.cwd LIKE ?)`;
      whereParams.push(`%${search}%`, `%${search}%`);
    }

    const havingClauses: string[] = [];
    const havingParams: Array<number> = [];
    if (!Number.isNaN(minTokensRaw) && minTokensRaw > 0) {
      havingClauses.push("SUM(e.total_tokens) >= ?");
      havingParams.push(minTokensRaw);
    }
    if (!Number.isNaN(minTurnsRaw) && minTurnsRaw > 0) {
      havingClauses.push("COUNT(*) >= ?");
      havingParams.push(minTurnsRaw);
    }
    if (!Number.isNaN(minTokensPerTurnRaw) && minTokensPerTurnRaw > 0) {
      havingClauses.push("(SUM(e.total_tokens) * 1.0 / COUNT(*)) >= ?");
      havingParams.push(minTokensPerTurnRaw);
    }

    const havingSql = havingClauses.length
      ? `HAVING ${havingClauses.join(" AND ")}`
      : "";

    const totalRow = db
      .prepare(
        `SELECT COUNT(*) as total FROM (
          SELECT e.session_id
          FROM events e
          LEFT JOIN sessions s ON s.session_id = e.session_id
          ${whereSql}
          AND e.session_id IS NOT NULL
          GROUP BY e.session_id
          ${havingSql}
        ) sub`
      )
      .get([...whereParams, ...havingParams]) as { total: number } | undefined;

    const rows = db
      .prepare(
        `SELECT e.session_id, s.cwd, s.cli_version, MAX(e.captured_at_utc) as last_seen,
          SUM(e.total_tokens) as total_tokens, COUNT(*) as turns,
          (
            SELECT group_concat(tag, ',')
            FROM session_tags st
            WHERE st.session_id = e.session_id
          ) as tags
        FROM events e
        LEFT JOIN sessions s ON s.session_id = e.session_id
        ${whereSql}
        AND e.session_id IS NOT NULL
        GROUP BY e.session_id
        ${havingSql}
        ORDER BY total_tokens DESC
        LIMIT ${pageSize} OFFSET ${offset}`
      )
      .all([...whereParams, ...havingParams])
      .map((row: Record<string, unknown>) => {
        const tags = typeof row.tags === "string" ? row.tags.split(",") : [];
        return {
          ...row,
          tags: tags.map((tag) => tag.trim()).filter(Boolean)
        };
      });

    return jsonResponse({
      page,
      page_size: pageSize,
      total: totalRow?.total ?? 0,
      rows
    });
  } catch (error) {
    return errorResponse(
      error instanceof Error ? error.message : "Failed to load sessions",
      500
    );
  }
};
