import { NextRequest } from "next/server";

import { errorResponse, jsonResponse } from "@/lib/server/response";
import { loadPricingSettings, savePricingSettings } from "@/lib/server/pricing";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = (request: NextRequest) => {
  try {
    const payload = loadPricingSettings(request.nextUrl.searchParams);
    return jsonResponse(payload);
  } catch (error) {
    return errorResponse(
      error instanceof Error ? error.message : "Failed to load pricing settings",
      500
    );
  }
};

export const PUT = async (request: NextRequest) => {
  try {
    const current = loadPricingSettings(request.nextUrl.searchParams);
    const body = await request.json().catch(() => ({}));
    const payload = typeof body === "object" && body !== null ? body : {};
    const currencyLabel =
      typeof payload.currency_label === "string"
        ? payload.currency_label
        : typeof payload.currencyLabel === "string"
          ? payload.currencyLabel
          : current.currency_label;
    const pricing =
      typeof payload.pricing === "object" && payload.pricing !== null
        ? payload.pricing
        : current.pricing;
    const saved = savePricingSettings(
      { currency_label: currencyLabel, pricing },
      request.nextUrl.searchParams
    );
    return jsonResponse(saved);
  } catch (error) {
    return errorResponse(
      error instanceof Error ? error.message : "Failed to save pricing settings",
      500
    );
  }
};
