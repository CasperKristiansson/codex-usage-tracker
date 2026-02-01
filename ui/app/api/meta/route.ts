import { getDb } from "@/lib/server/db";
import { errorResponse, jsonResponse } from "@/lib/server/response";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = () => {
  try {
    const db = getDb();
    const eventsCount = db
      .prepare("SELECT COUNT(*) as count FROM events")
      .get() as { count: number };
    const sessionsCount = db
      .prepare("SELECT COUNT(*) as count FROM sessions")
      .get() as { count: number };
    const turnsCount = db
      .prepare("SELECT COUNT(*) as count FROM turns")
      .get() as { count: number };
    const toolCallsCount = db
      .prepare("SELECT COUNT(*) as count FROM tool_calls")
      .get() as { count: number };
    const activityCount = db
      .prepare("SELECT COUNT(*) as count FROM activity_events")
      .get() as { count: number };

    const rowCounts = {
      events: eventsCount.count,
      sessions: sessionsCount.count,
      turns: turnsCount.count,
      tool_calls: toolCallsCount.count,
      activity_events: activityCount.count
    };

    const timestamps = db
      .prepare(
        "SELECT MIN(captured_at_utc) as min_ts, MAX(captured_at_utc) as max_ts FROM events"
      )
      .get() as { min_ts: string | null; max_ts: string | null };

    const distinct = db
      .prepare(
        "SELECT COUNT(DISTINCT model) as models, COUNT(DISTINCT directory) as directories, COUNT(DISTINCT source) as sources FROM events"
      )
      .get() as { models: number; directories: number; sources: number };

    const lastIngested = db
      .prepare("SELECT MAX(last_ingested_at) as last_ingested_at FROM ingestion_files")
      .get() as { last_ingested_at: string | null };

    return jsonResponse({
      row_counts: rowCounts,
      min_timestamp_utc: timestamps.min_ts,
      max_timestamp_utc: timestamps.max_ts,
      distinct: {
        models: distinct.models,
        directories: distinct.directories,
        sources: distinct.sources
      },
      last_ingested_at: lastIngested.last_ingested_at,
      ingested_range_utc: {
        from: timestamps.min_ts,
        to: timestamps.max_ts
      }
    });
  } catch (error) {
    return errorResponse(
      error instanceof Error ? error.message : "Failed to load metadata",
      500
    );
  }
};
