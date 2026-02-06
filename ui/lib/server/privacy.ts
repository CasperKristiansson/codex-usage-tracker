import { loadConfigPayload, saveConfigPayload } from "@/lib/server/config";

export type PrivacySettings = {
  capture_payloads: boolean;
};

type RawPrivacyPayload = {
  capture_payloads?: unknown;
  capturePayloads?: unknown;
};

const coerceBool = (value: unknown): boolean | null => {
  if (typeof value === "boolean") return value;
  if (typeof value === "number" && Number.isFinite(value)) {
    if (value === 1) return true;
    if (value === 0) return false;
  }
  if (typeof value === "string") {
    const trimmed = value.trim().toLowerCase();
    if (["true", "yes", "1", "on"].includes(trimmed)) return true;
    if (["false", "no", "0", "off"].includes(trimmed)) return false;
  }
  return null;
};

export const loadPrivacySettings = (
  dbOverride?: URLSearchParams | string | null
): PrivacySettings => {
  const { payload } = loadConfigPayload(dbOverride);
  const raw = payload as RawPrivacyPayload;
  const candidate = raw.capture_payloads ?? raw.capturePayloads;
  const capture_payloads = coerceBool(candidate) ?? false;
  return { capture_payloads };
};

export const savePrivacySettings = (
  capturePayloads: boolean,
  dbOverride?: URLSearchParams | string | null
): PrivacySettings => {
  const { payload: existing } = loadConfigPayload(dbOverride);
  const payload: Record<string, unknown> = { ...existing };

  delete payload.capture_payloads;
  delete payload.capturePayloads;

  if (capturePayloads) {
    payload.capture_payloads = true;
  }

  saveConfigPayload(payload, dbOverride);
  return { capture_payloads: capturePayloads };
};

