import { NextRequest } from "next/server";

import { errorResponse, jsonResponse } from "@/lib/server/response";
import { readSyncProgress } from "@/lib/server/sync";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = (request: NextRequest) => {
  const syncId = request.nextUrl.searchParams.get("sync_id");
  if (!syncId) {
    return errorResponse("sync_id is required", 400);
  }
  const progress = readSyncProgress(syncId);
  return jsonResponse(progress);
};
