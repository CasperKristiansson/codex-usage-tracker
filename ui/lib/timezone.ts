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
  const rounded = Math.round(minutes);
  const sign = rounded >= 0 ? "+" : "-";
  const abs = Math.abs(rounded);
  const hours = Math.floor(abs / 60);
  const mins = abs % 60;
  return `${sign}${pad(hours)}:${pad(mins)}`;
};

const ISO_WITH_OFFSET =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?(?:\.(\d{1,3}))?(Z|[+-]\d{2}:?\d{2})$/;

const parseOffsetMinutes = (value: string) => {
  if (value === "Z") return 0;
  const sign = value.startsWith("-") ? -1 : 1;
  const offset = value.slice(1);
  const parts = offset.includes(":")
    ? offset.split(":")
    : [offset.slice(0, 2), offset.slice(2)];
  const hours = Number(parts[0]);
  const minutes = Number(parts[1]);
  if (
    Number.isNaN(hours) ||
    Number.isNaN(minutes) ||
    minutes < 0 ||
    minutes >= 60
  ) {
    return null;
  }
  return sign * (hours * 60 + minutes);
};

export const parseIsoToMs = (value?: string | null) => {
  if (!value) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  const match = ISO_WITH_OFFSET.exec(trimmed);
  if (!match) {
    const parsed = Date.parse(trimmed);
    return Number.isFinite(parsed) ? parsed : null;
  }
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const hour = Number(match[4]);
  const minute = Number(match[5]);
  const second = match[6] ? Number(match[6]) : 0;
  const millis = match[7] ? Number(match[7].padEnd(3, "0")) : 0;
  if (
    [year, month, day, hour, minute, second, millis].some((value) =>
      Number.isNaN(value)
    )
  ) {
    return null;
  }
  const offsetMinutes = match[8] ? parseOffsetMinutes(match[8]) : 0;
  if (offsetMinutes === null) return null;
  const utc = Date.UTC(year, month - 1, day, hour, minute, second, millis);
  if (!Number.isFinite(utc)) return null;
  return utc - offsetMinutes * 60_000;
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
