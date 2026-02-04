import { NextRequest } from "next/server";

import { getDb } from "@/lib/server/db";
import { ensureSessionAnnotationTables } from "@/lib/server/session-annotations";
import { errorResponse, jsonResponse } from "@/lib/server/response";

const normalizeTags = (tags: unknown) => {
  if (!Array.isArray(tags)) return [];
  const normalized = tags
    .map((tag) => (typeof tag === "string" ? tag.trim() : ""))
    .filter(Boolean)
    .map((tag) => tag.replace(/,/g, " "));
  return Array.from(new Set(normalized));
};

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = (request: NextRequest) => {
  try {
    const sessionId = request.nextUrl.searchParams.get("session_id");
    if (!sessionId) {
      return errorResponse("session_id is required", 400);
    }

    const db = getDb(request.nextUrl.searchParams);
    ensureSessionAnnotationTables(db);

    const annotation = db
      .prepare(
        "SELECT session_id, note, updated_at FROM session_annotations WHERE session_id = ?"
      )
      .get(sessionId) as { session_id: string; note: string | null; updated_at: string | null } | undefined;

    const tags = db
      .prepare("SELECT tag FROM session_tags WHERE session_id = ? ORDER BY tag ASC")
      .all(sessionId) as Array<{ tag: string }>;

    return jsonResponse({
      session_id: sessionId,
      note: annotation?.note ?? "",
      updated_at: annotation?.updated_at ?? null,
      tags: tags.map((row) => row.tag)
    });
  } catch (error) {
    return errorResponse(
      error instanceof Error ? error.message : "Failed to load session annotation",
      500
    );
  }
};

export const PUT = async (request: NextRequest) => {
  try {
    const payload = (await request.json()) as {
      session_id?: string;
      note?: string | null;
      tags?: string[];
    };

    const sessionId = payload.session_id?.trim();
    if (!sessionId) {
      return errorResponse("session_id is required", 400);
    }

    const note = typeof payload.note === "string" ? payload.note.trim() : "";
    const tags = normalizeTags(payload.tags);
    const updatedAt = new Date().toISOString();

    const db = getDb(request.nextUrl.searchParams);
    ensureSessionAnnotationTables(db);

    const transaction = db.transaction(() => {
      db.prepare(
        `
        INSERT INTO session_annotations (session_id, note, updated_at)
        VALUES (?, ?, ?)
        ON CONFLICT(session_id) DO UPDATE SET
          note = excluded.note,
          updated_at = excluded.updated_at
        `
      ).run(sessionId, note, updatedAt);

      db.prepare("DELETE FROM session_tags WHERE session_id = ?").run(sessionId);

      if (tags.length) {
        const insert = db.prepare(
          "INSERT INTO session_tags (session_id, tag, updated_at) VALUES (?, ?, ?)"
        );
        tags.forEach((tag) => {
          insert.run(sessionId, tag, updatedAt);
        });
      }
    });

    transaction();

    return jsonResponse({
      session_id: sessionId,
      note,
      updated_at: updatedAt,
      tags
    });
  } catch (error) {
    return errorResponse(
      error instanceof Error ? error.message : "Failed to save session annotation",
      500
    );
  }
};
