export const DEFAULT_TIMEZONE = "Europe/Stockholm";

const formatterCache = new Map<string, Intl.DateTimeFormat>();

export const isValidTimeZone = (value: string) => {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value }).format();
    return true;
  } catch {
    return false;
  }
};

export const normalizeTimeZone = (value?: string | null) => {
  if (!value || typeof value !== "string") return DEFAULT_TIMEZONE;
  const trimmed = value.trim();
  if (!trimmed) return DEFAULT_TIMEZONE;
  return isValidTimeZone(trimmed) ? trimmed : DEFAULT_TIMEZONE;
};

const getFormatter = (timeZone: string) => {
  const key = `${timeZone}`;
  const cached = formatterCache.get(key);
  if (cached) return cached;
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false
  });
  formatterCache.set(key, formatter);
  return formatter;
};

const getTimeZoneParts = (date: Date, timeZone: string) => {
  const formatter = getFormatter(timeZone);
  const parts = formatter.formatToParts(date);
  const lookup: Record<string, string> = {};
  parts.forEach((part) => {
    if (part.type !== "literal") {
      lookup[part.type] = part.value;
    }
  });
  return {
    year: lookup.year,
    month: lookup.month,
    day: lookup.day,
    hour: lookup.hour,
    minute: lookup.minute,
    second: lookup.second
  };
};

const pad = (value: number) => String(value).padStart(2, "0");

const formatOffset = (minutes: number) => {
  const sign = minutes >= 0 ? "+" : "-";
  const abs = Math.abs(minutes);
  const hours = Math.floor(abs / 60);
  const mins = Math.round(abs % 60);
  return `${sign}${pad(hours)}:${pad(mins)}`;
};

export const getTimeZoneOffsetMinutes = (date: Date, timeZone: string) => {
  const parts = getTimeZoneParts(date, timeZone);
  const asUtc = Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day),
    Number(parts.hour),
    Number(parts.minute),
    Number(parts.second)
  );
  return (asUtc - date.getTime()) / 60000;
};

export const toZonedIso = (date: Date, timeZone: string) => {
  const tz = normalizeTimeZone(timeZone);
  const parts = getTimeZoneParts(date, tz);
  const offset = getTimeZoneOffsetMinutes(date, tz);
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}:${parts.second}${formatOffset(offset)}`;
};

export const formatDateTimeInput = (iso: string, timeZone: string) => {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  const tz = normalizeTimeZone(timeZone);
  const parts = getTimeZoneParts(date, tz);
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}`;
};

export const parseDateTimeInput = (value: string, timeZone: string) => {
  if (!value) return "";
  const [datePart, timePart] = value.split("T");
  if (!datePart || !timePart) return "";
  const [year, month, day] = datePart.split("-").map(Number);
  const [hour, minute] = timePart.split(":").map(Number);
  if (!year || !month || !day || Number.isNaN(hour) || Number.isNaN(minute)) {
    return "";
  }
  const tz = normalizeTimeZone(timeZone);
  const utcGuess = new Date(Date.UTC(year, month - 1, day, hour, minute, 0));
  let offset = getTimeZoneOffsetMinutes(utcGuess, tz);
  let adjusted = new Date(utcGuess.getTime() - offset * 60000);
  const verifyOffset = getTimeZoneOffsetMinutes(adjusted, tz);
  if (verifyOffset !== offset) {
    offset = verifyOffset;
    adjusted = new Date(utcGuess.getTime() - offset * 60000);
  }
  const parts = getTimeZoneParts(adjusted, tz);
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}:00${formatOffset(offset)}`;
};

export const formatTimestamp = (value?: string | null, timeZone?: string) => {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  const tz = normalizeTimeZone(timeZone);
  return date.toLocaleString(undefined, { timeZone: tz });
};
