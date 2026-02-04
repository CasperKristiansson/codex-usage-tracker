import { NextRequest } from "next/server";

import { errorResponse, jsonResponse } from "@/lib/server/response";
import {
  loadTimezoneSettings,
  saveTimezoneSettings
} from "@/lib/server/timezone";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = (request: NextRequest) => {
  try {
    const payload = loadTimezoneSettings(request.nextUrl.searchParams);
    return jsonResponse(payload);
  } catch (error) {
    return errorResponse(
      error instanceof Error ? error.message : "Failed to load timezone settings",
      500
    );
  }
};

export const PUT = async (request: NextRequest) => {
  try {
    const body = await request.json().catch(() => ({}));
    const payload = typeof body === "object" && body !== null ? body : {};
    const timezone = typeof payload.timezone === "string" ? payload.timezone : "";
    const saved = saveTimezoneSettings(timezone, request.nextUrl.searchParams);
    return jsonResponse(saved);
  } catch (error) {
    return errorResponse(
      error instanceof Error ? error.message : "Failed to save timezone settings",
      400
    );
  }
};
