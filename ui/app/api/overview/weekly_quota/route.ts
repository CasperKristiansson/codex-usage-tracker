import { NextRequest } from "next/server";

import { getDb } from "@/lib/server/db";
import { errorResponse, jsonResponse } from "@/lib/server/response";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = (request: NextRequest) => {
  try {
    const db = getDb(request.nextUrl.searchParams);
    const row = db
      .prepare(
        `SELECT *
        FROM weekly_quota_estimates
        ORDER BY week_end DESC
        LIMIT 1`
      )
      .get();

    return jsonResponse({ row: row ?? null });
  } catch (error) {
    return errorResponse(
      error instanceof Error ? error.message : "Failed to load weekly quota",
      500
    );
  }
};
