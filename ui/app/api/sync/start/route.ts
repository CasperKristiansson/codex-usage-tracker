import { NextRequest } from "next/server";

import { parseFilters } from "@/lib/server/filters";
import { errorResponse, jsonResponse } from "@/lib/server/response";
import { startSync } from "@/lib/server/sync";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const POST = async (request: NextRequest) => {
  try {
    const filters = parseFilters(request.nextUrl.searchParams);
    const dbPath = request.nextUrl.searchParams.get("db");
    const body = await request.json().catch(() => null);
    if (body?.from) {
      const parsed = new Date(body.from);
      if (!Number.isNaN(parsed.getTime())) {
        filters.from = parsed.toISOString();
      }
    }
    if (body?.to) {
      const parsed = new Date(body.to);
      if (!Number.isNaN(parsed.getTime())) {
        filters.to = parsed.toISOString();
      }
    }

    const syncId = startSync(filters, dbPath);
    return jsonResponse({ sync_id: syncId });
  } catch (error) {
    return errorResponse(
      error instanceof Error ? error.message : "Failed to start sync",
      500
    );
  }
};
