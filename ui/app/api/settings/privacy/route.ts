import { NextRequest } from "next/server";

import { errorResponse, jsonResponse } from "@/lib/server/response";
import { loadPrivacySettings, savePrivacySettings } from "@/lib/server/privacy";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = (request: NextRequest) => {
  try {
    const payload = loadPrivacySettings(request.nextUrl.searchParams);
    return jsonResponse(payload);
  } catch (error) {
    return errorResponse(
      error instanceof Error ? error.message : "Failed to load privacy settings",
      500
    );
  }
};

export const PUT = async (request: NextRequest) => {
  try {
    const current = loadPrivacySettings(request.nextUrl.searchParams);
    const body = await request.json().catch(() => ({}));
    const payload = typeof body === "object" && body !== null ? body : {};

    const candidate =
      typeof (payload as { capture_payloads?: unknown }).capture_payloads === "boolean"
        ? (payload as { capture_payloads: boolean }).capture_payloads
        : typeof (payload as { capturePayloads?: unknown }).capturePayloads === "boolean"
          ? (payload as { capturePayloads: boolean }).capturePayloads
          : current.capture_payloads;

    const saved = savePrivacySettings(candidate, request.nextUrl.searchParams);
    return jsonResponse(saved);
  } catch (error) {
    return errorResponse(
      error instanceof Error ? error.message : "Failed to save privacy settings",
      400
    );
  }
};

