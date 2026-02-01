import { NextRequest } from "next/server";

import { DEBUG_ROW_LIMIT, DEBUG_TEXT_LIMIT } from "@/lib/server/constants";
import { parseFilters } from "@/lib/server/filters";
import { getDb } from "@/lib/server/db";
import { buildWhere } from "@/lib/server/query";
import { errorResponse, jsonResponse } from "@/lib/server/response";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = (request: NextRequest) => {
  try {
    const filters = parseFilters(request.nextUrl.searchParams);
    const sessionId = request.nextUrl.searchParams.get("session_id");
    const turnIndex = request.nextUrl.searchParams.get("turn_index");

    if (!sessionId || !turnIndex) {
      return errorResponse("session_id and turn_index are required", 400);
    }

    const turnIndexNum = Number(turnIndex);
    if (Number.isNaN(turnIndexNum)) {
      return errorResponse("turn_index must be a number", 400);
    }

    const db = getDb();
    const base = buildWhere(filters, {
      timeColumn: "captured_at_utc",
      sourceColumn: "source"
    });

    const whereSql = `${base.sql} AND session_id = ? AND turn_index = ?`;
    const params = [...base.params, sessionId, turnIndexNum];

    const rows = db
      .prepare(
        `SELECT captured_at_utc, role, message_type,
          substr(message, 1, ${DEBUG_TEXT_LIMIT}) as message,
          session_id, turn_index
        FROM content_messages
        ${whereSql}
        ORDER BY captured_at_utc ASC
        LIMIT ${DEBUG_ROW_LIMIT}`
      )
      .all(params);

    return jsonResponse({ rows });
  } catch (error) {
    return errorResponse(
      error instanceof Error ? error.message : "Failed to load messages",
      500
    );
  }
};
