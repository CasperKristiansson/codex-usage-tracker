import { NextRequest } from "next/server";

import { getDb } from "@/lib/server/db";
import { errorResponse, jsonResponse } from "@/lib/server/response";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = (request: NextRequest) => {
  try {
    const sessionId = request.nextUrl.searchParams.get("session_id");
    if (!sessionId) {
      return errorResponse("session_id is required", 400);
    }

    const db = getDb(request.nextUrl.searchParams);
    const session = db
      .prepare("SELECT * FROM sessions WHERE session_id = ?")
      .get(sessionId);
    if (!session) {
      return errorResponse("session not found", 404);
    }

    const totals = db
      .prepare(
        `SELECT SUM(total_tokens) as total_tokens, COUNT(*) as turns
        FROM events
        WHERE session_id = ? AND event_type = 'token_count'`
      )
      .get(sessionId);

    const models = db
      .prepare(
        `SELECT model, SUM(total_tokens) as total_tokens
        FROM events
        WHERE session_id = ? AND event_type = 'token_count'
        GROUP BY model
        ORDER BY total_tokens DESC
        LIMIT 10`
      )
      .all(sessionId);

    const directories = db
      .prepare(
        `SELECT directory, SUM(total_tokens) as total_tokens
        FROM events
        WHERE session_id = ? AND event_type = 'token_count'
        GROUP BY directory
        ORDER BY total_tokens DESC
        LIMIT 10`
      )
      .all(sessionId);

    return jsonResponse({
      session,
      totals,
      top_models: models,
      top_directories: directories
    });
  } catch (error) {
    return errorResponse(
      error instanceof Error ? error.message : "Failed to load session detail",
      500
    );
  }
};
