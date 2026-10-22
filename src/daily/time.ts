/**
 * The time of the vault.
 *
 * Everything the bot knows about days and months is calculated in the time
 * zone of the owner, so "yesterday" means yesterday where the owner lives.
 */

export interface ZonedParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

/** The parts of a moment in a time zone. */
export function zonedParts(date: Date, timeZone: string): ZonedParts {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
  const parts = formatter.formatToParts(date);
  const value = (type: string) => Number(parts.find((part) => part.type === type)?.value ?? "0");
  return {
    year: value("year"),
    month: value("month"),
    day: value("day"),
    hour: value("hour") % 24,
    minute: value("minute"),
    second: value("second"),
  };
}

/** The date of a moment in a time zone, for example `2026-10-22`. */
export function localDate(date: Date, timeZone: string): string {
  const parts = zonedParts(date, timeZone);
  return `${parts.year}-${pad(parts.month)}-${pad(parts.day)}`;
}

/** The day before a day, for example `2026-10-21` -> `2026-10-20`. */
export function previousDay(day: string): string {
  const [year, month, date] = day.split("-").map(Number);
  const stamp = Date.UTC(year ?? 1970, (month ?? 1) - 1, date ?? 1) - 86_400_000;
  const back = new Date(stamp);
  return `${back.getUTCFullYear()}-${pad(back.getUTCMonth() + 1)}-${pad(back.getUTCDate())}`;
}

/** The name of the file of a month, for example `october_2026.md`. */
export function monthFileName(day: string): string {
  const [year, month] = day.split("-").map(Number);
  const date = new Date(Date.UTC(year ?? 1970, (month ?? 1) - 1, 1));
  const name = new Intl.DateTimeFormat("en-US", { month: "long", timeZone: "UTC" })
    .format(date)
    .toLowerCase();
  return `${name}_${date.getUTCFullYear()}.md`;
}

/** The title of the file of a month, for example `Октябрь 2026` or `October 2026`. */
export function monthTitle(day: string, language: "en" | "ru" = "ru"): string {
  const [year, month] = day.split("-").map(Number);
  const date = new Date(Date.UTC(year ?? 1970, (month ?? 1) - 1, 1));
  const name = new Intl.DateTimeFormat(language === "en" ? "en-US" : "ru-RU", {
    month: "long",
    timeZone: "UTC",
  }).format(date);
  return `${name.charAt(0).toUpperCase()}${name.slice(1)} ${date.getUTCFullYear()}`;
}

/** The offset of a time zone against UTC, in milliseconds. */
export function timeZoneOffsetMs(date: Date, timeZone: string): number {
  const parts = zonedParts(date, timeZone);
  const asUtc = Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour,
    parts.minute,
    parts.second,
  );
  return asUtc - Math.floor(date.getTime() / 1000) * 1000;
}

/** The moment when a local day begins, in UTC milliseconds. */
export function localDayStartMs(day: string, timeZone: string): number {
  const [year, month, date] = day.split("-").map(Number);
  const wall = Date.UTC(year ?? 1970, (month ?? 1) - 1, date ?? 1);
  let result = wall - timeZoneOffsetMs(new Date(wall), timeZone);
  // A second pass for the days when the offset changes at night.
  const refined = wall - timeZoneOffsetMs(new Date(result), timeZone);
  if (refined !== result) result = refined;
  return result;
}

/** The moment when the next local midnight comes, in UTC milliseconds. */
export function nextLocalMidnightMs(now: Date, timeZone: string): number {
  const parts = zonedParts(now, timeZone);
  const wall = Date.UTC(parts.year, parts.month - 1, parts.day + 1, 0, 0, 0);
  let result = wall - timeZoneOffsetMs(new Date(wall), timeZone);
  const refined = wall - timeZoneOffsetMs(new Date(result), timeZone);
  if (refined !== result) result = refined;
  return result;
}

function pad(value: number): string {
  return String(value).padStart(2, "0");
}
