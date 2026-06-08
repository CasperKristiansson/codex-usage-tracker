import { NextRequest } from "next/server";

import { getDb } from "@/lib/server/db";
import { errorResponse, jsonResponse } from "@/lib/server/response";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

const clampLimit = (value: string | null) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_LIMIT;
  return Math.min(Math.floor(parsed), MAX_LIMIT);
};

const quoteFts = (query: string) =>
  query
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((part) => `"${part.replace(/"/g, '""')}"`)
    .join(" ");

export const GET = (request: NextRequest) => {
  try {
    const q = request.nextUrl.searchParams.get("q")?.trim();
    if (!q) {
      return jsonResponse({ rows: [] });
    }
    const sessionId = request.nextUrl.searchParams.get("session_id");
    const limit = clampLimit(request.nextUrl.searchParams.get("limit"));
    const db = getDb(request.nextUrl.searchParams);

    const params: Array<string | number> = [quoteFts(q)];
    let sessionSql = "";
    if (sessionId) {
      sessionSql = "AND m.session_id = ?";
      params.push(sessionId);
    }
    params.push(limit);

    try {
      const rows = db
        .prepare(
          `SELECT m.id, m.session_id, m.turn_index, m.ordinal, m.role,
            m.message_type, m.captured_at_utc,
            snippet(messages_fts, 0, '<mark>', '</mark>', '...', 32) AS snippet
          FROM messages_fts
          JOIN messages m ON messages_fts.rowid = m.id
          WHERE messages_fts MATCH ?
            ${sessionSql}
          ORDER BY rank, m.captured_at_utc DESC
          LIMIT ?`
        )
        .all(...params);
      return jsonResponse({ rows });
    } catch {
      const likeParams: Array<string | number> = [`%${q}%`];
      let likeSessionSql = "";
      if (sessionId) {
        likeSessionSql = "AND session_id = ?";
        likeParams.push(sessionId);
      }
      likeParams.push(limit);
      const rows = db
        .prepare(
          `SELECT id, session_id, turn_index, ordinal, role, message_type,
            captured_at_utc, substr(content, 1, 240) AS snippet
          FROM messages
          WHERE content LIKE ?
            ${likeSessionSql}
          ORDER BY captured_at_utc DESC
          LIMIT ?`
        )
        .all(...likeParams);
      return jsonResponse({ rows, fallback: "like" });
    }
  } catch (error) {
    return errorResponse(
      error instanceof Error ? error.message : "Failed to search messages",
      500
    );
  }
};
