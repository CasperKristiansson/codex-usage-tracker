import { loadConfigPayload, saveConfigPayload } from "@/lib/server/config";

export type PrivacySettings = {
  capture_payloads: boolean;
};

export const loadPrivacySettings = (
  dbOverride?: URLSearchParams | string | null
): PrivacySettings => {
  loadConfigPayload(dbOverride);
  return { capture_payloads: true };
};

export const savePrivacySettings = (
  _capturePayloads: boolean,
  dbOverride?: URLSearchParams | string | null
): PrivacySettings => {
  const { payload: existing } = loadConfigPayload(dbOverride);
  const payload: Record<string, unknown> = { ...existing };

  delete payload.capture_payloads;
  delete payload.capturePayloads;

  saveConfigPayload(payload, dbOverride);
  return { capture_payloads: true };
};
