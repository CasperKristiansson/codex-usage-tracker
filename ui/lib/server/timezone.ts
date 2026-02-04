import { DEFAULT_TIMEZONE, isValidTimeZone, normalizeTimeZone } from "@/lib/timezone";
import { loadConfigPayload, saveConfigPayload } from "@/lib/server/config";

type TimezonePayload = {
  timezone?: string;
  time_zone?: string;
  tz?: string;
};

export type TimezoneSettings = {
  timezone: string;
};

export const loadTimezoneSettings = (
  dbOverride?: URLSearchParams | string | null
): TimezoneSettings => {
  const { payload } = loadConfigPayload(dbOverride);
  const raw = payload as TimezonePayload;
  const candidate = raw.timezone ?? raw.time_zone ?? raw.tz;
  const timezone = normalizeTimeZone(
    typeof candidate === "string" ? candidate : DEFAULT_TIMEZONE
  );
  return { timezone };
};

export const saveTimezoneSettings = (
  timezoneValue: string,
  dbOverride?: URLSearchParams | string | null
) => {
  const trimmed = timezoneValue.trim();
  if (!trimmed) {
    throw new Error("Timezone is required");
  }
  if (!isValidTimeZone(trimmed)) {
    throw new Error(
      `Invalid timezone: ${trimmed}. Expected an IANA timezone like ${DEFAULT_TIMEZONE}.`
    );
  }
  const { payload: existing } = loadConfigPayload(dbOverride);
  const payload: Record<string, unknown> = { ...existing };
  delete payload.timezone;
  delete payload.time_zone;
  delete payload.tz;

  if (trimmed !== DEFAULT_TIMEZONE) {
    payload.timezone = trimmed;
  }

  saveConfigPayload(payload, dbOverride);
  return { timezone: trimmed } as TimezoneSettings;
};
