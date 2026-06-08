import { NextRequest } from "next/server";

import { getDb } from "@/lib/server/db";
import { loadPrivacySettings } from "@/lib/server/privacy";
import { errorResponse, jsonResponse } from "@/lib/server/response";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DEFAULT_LIMIT = 200;
const MAX_LIMIT = 500;

const clampLimit = (value: string | null) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_LIMIT;
  return Math.min(Math.floor(parsed), MAX_LIMIT);
};

export const GET = (request: NextRequest) => {
  try {
    const sessionId = request.nextUrl.searchParams.get("session_id");
    if (!sessionId) {
      return errorResponse("session_id is required", 400);
    }

    const afterRaw = request.nextUrl.searchParams.get("after");
    const after = afterRaw === null ? null : Number(afterRaw);
    if (afterRaw !== null && !Number.isFinite(after)) {
      return errorResponse("after must be a number", 400);
    }

    const limit = clampLimit(request.nextUrl.searchParams.get("limit"));
    const db = getDb(request.nextUrl.searchParams);
    const privacy = loadPrivacySettings(request.nextUrl.searchParams);

    const rows = db
      .prepare(
        `SELECT id, captured_at_utc, role, message_type, content, content_length,
          session_id, turn_index, ordinal, source_line
        FROM messages
        WHERE session_id = ?
          AND (? IS NULL OR ordinal > ?)
        ORDER BY ordinal ASC, captured_at_utc ASC, id ASC
        LIMIT ?`
      )
      .all(sessionId, after, after, limit + 1) as Array<{
      ordinal: number | null;
    }>;

    const hasMore = rows.length > limit;
    const pageRows = hasMore ? rows.slice(0, limit) : rows;
    const last = pageRows[pageRows.length - 1];

    return jsonResponse({
      rows: pageRows,
      next_cursor: hasMore && last?.ordinal !== null ? last?.ordinal : null,
      storage_disabled: !privacy.capture_payloads
    });
  } catch (error) {
    return errorResponse(
      error instanceof Error ? error.message : "Failed to load session messages",
      500
    );
  }
};
