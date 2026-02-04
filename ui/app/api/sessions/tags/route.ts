import { NextRequest } from "next/server";

import { getDb } from "@/lib/server/db";
import { ensureSessionAnnotationTables } from "@/lib/server/session-annotations";
import { errorResponse, jsonResponse } from "@/lib/server/response";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = (request: NextRequest) => {
  try {
    const db = getDb(request.nextUrl.searchParams);
    ensureSessionAnnotationTables(db);

    const rows = db
      .prepare("SELECT DISTINCT tag FROM session_tags ORDER BY tag ASC")
      .all() as Array<{ tag: string }>;

    return jsonResponse({ tags: rows.map((row) => row.tag) });
  } catch (error) {
    return errorResponse(
      error instanceof Error ? error.message : "Failed to load session tags",
      500
    );
  }
};
