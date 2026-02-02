import { NextRequest } from "next/server";

import { DEBUG_ROW_LIMIT, DEBUG_TEXT_LIMIT } from "@/lib/server/constants";
import { getRangeHours, parseFilters } from "@/lib/server/filters";
import { getDb } from "@/lib/server/db";
import { buildToolJoin } from "@/lib/server/query";
import { errorResponse, jsonResponse } from "@/lib/server/response";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = (request: NextRequest) => {
  try {
    const filters = parseFilters(request.nextUrl.searchParams);
    const sessionId = request.nextUrl.searchParams.get("session_id");
    const toolLabel = request.nextUrl.searchParams.get("tool");
    const rangeHours = getRangeHours(filters);

    if (!sessionId && rangeHours > 24) {
      return errorResponse("session_id or <=24h range required", 400);
    }

    const db = getDb(request.nextUrl.searchParams);
    const tool = buildToolJoin(filters);
    const params = [...tool.params];
    let whereSql = tool.where;

    if (sessionId) {
      whereSql = `${whereSql} AND tc.session_id = ?`;
      params.push(sessionId);
    }

    if (toolLabel) {
      whereSql = `${whereSql} AND COALESCE(tc.tool_name, tc.tool_type) = ?`;
      params.push(toolLabel);
    }

    const rows = db
      .prepare(
        `SELECT tc.captured_at_utc, tc.tool_type, tc.tool_name, tc.status, tc.call_id,
          substr(tc.input_text, 1, ${DEBUG_TEXT_LIMIT}) as input_text,
          substr(tc.output_text, 1, ${DEBUG_TEXT_LIMIT}) as output_text,
          tc.command, tc.session_id, tc.turn_index
        FROM tool_calls tc
        ${tool.join}
        ${whereSql}
        ORDER BY tc.captured_at_utc DESC
        LIMIT ${DEBUG_ROW_LIMIT}`
      )
      .all(params);

    return jsonResponse({ rows });
  } catch (error) {
    return errorResponse(
      error instanceof Error ? error.message : "Failed to load tool call samples",
      500
    );
  }
};
