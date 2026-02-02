import fs from "fs";

import { NextRequest } from "next/server";

import { getDb, resolveDbPathFromParams } from "@/lib/server/db";
import { resolveDbPath } from "@/lib/server/paths";
import { errorResponse, jsonResponse } from "@/lib/server/response";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = (request: NextRequest) => {
  try {
    const params = request.nextUrl.searchParams;
    const activePath = resolveDbPathFromParams(params);
    const defaultPath = resolveDbPath();
    const exists = fs.existsSync(activePath);

    let rowCounts: Record<string, number> | null = null;
    let lastIngested: string | null = null;
    let error: string | null = null;

    try {
      const db = getDb(params);
      const events = db
        .prepare("SELECT COUNT(*) as count FROM events")
        .get() as { count: number };
      const toolCalls = db
        .prepare("SELECT COUNT(*) as count FROM tool_calls")
        .get() as { count: number };
      const turns = db
        .prepare("SELECT COUNT(*) as count FROM turns")
        .get() as { count: number };
      const sessions = db
        .prepare("SELECT COUNT(*) as count FROM sessions")
        .get() as { count: number };
      rowCounts = {
        events: events.count,
        tool_calls: toolCalls.count,
        turns: turns.count,
        sessions: sessions.count
      };
      const ingested = db
        .prepare("SELECT MAX(last_ingested_at) as last_ingested_at FROM ingestion_files")
        .get() as { last_ingested_at: string | null };
      lastIngested = ingested?.last_ingested_at ?? null;
    } catch (err) {
      error = err instanceof Error ? err.message : "Failed to open database";
    }

    return jsonResponse({
      active_path: activePath,
      default_path: defaultPath,
      exists,
      row_counts: rowCounts,
      last_ingested_at: lastIngested,
      error
    });
  } catch (error) {
    return errorResponse(
      error instanceof Error ? error.message : "Failed to load DB info",
      500
    );
  }
};
