// The one place dates and times are formatted for display (docs/UX-DESIGN-REFACTOR-PLAN.md G-09 / DS-13).
// Output is always en-US, 12-hour, and Atlanta time. Pages say "Times are Atlanta time" once; never per line.
export const ATLANTA_TZ = "America/New_York";
const BAD = "Date unavailable";

function currentYear(now: Date) {
  return Number(new Intl.DateTimeFormat("en-US", { timeZone: ATLANTA_TZ, year: "numeric" }).format(now));
}
function ymd(value: string) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
  if (!m) return null;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const date = new Date(Date.UTC(y, mo - 1, d, 12));
  return date.getUTCFullYear() === y && date.getUTCMonth() === mo - 1 && date.getUTCDate() === d ? { y, date } : null;
}

/** A calendar date ("2026-12-12"): "Sat, Dec 12" (year added when not this year), or long "Saturday, December 12, 2026". */
export function eventDate(value: string, opts: { long?: boolean; now?: Date } = {}): string {
  const p = ymd(value); if (!p) return BAD;
  if (opts.long) return new Intl.DateTimeFormat("en-US", { timeZone: "UTC", weekday: "long", month: "long", day: "numeric", year: "numeric" }).format(p.date);
  const withYear = p.y !== currentYear(opts.now ?? new Date());
  return new Intl.DateTimeFormat("en-US", { timeZone: "UTC", weekday: "short", month: "short", day: "numeric", year: withYear ? "numeric" : undefined }).format(p.date);
}
/** A date that always shows its year, no weekday ("April 14, 1990"). For birthdays and records. */
export function calendarDate(value: string): string {
  const p = ymd(value); if (!p) return BAD;
  return new Intl.DateTimeFormat("en-US", { timeZone: "UTC", month: "long", day: "numeric", year: "numeric" }).format(p.date);
}
/** A wall-clock time ("19:00" or "19:00:00"): "7:00 PM". */
export function eventTime(value: string | null | undefined): string {
  const m = /^(\d{1,2}):(\d{2})/.exec(value ?? "");
  if (!m || Number(m[1]) > 23 || Number(m[2]) > 59) return "Time unavailable";
  return new Intl.DateTimeFormat("en-US", { timeZone: "UTC", hour: "numeric", minute: "2-digit" }).format(new Date(Date.UTC(2000, 0, 1, Number(m[1]), Number(m[2]))));
}
/** A wall-clock time plus minutes (itinerary stops): clockAfter("19:00", 45) → "7:45 PM". */
export function clockAfter(value: string, minutes: number): string {
  const m = /^(\d{1,2}):(\d{2})/.exec(value);
  if (!m) return "Time unavailable";
  const total = (Number(m[1]) * 60 + Number(m[2]) + minutes) % (24 * 60);
  return eventTime(`${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`);
}
/** Date and time of an event: "Sat, Dec 12 · 7:00 PM". */
export function eventWhen(date: string, time: string, opts: { now?: Date } = {}): string {
  return `${eventDate(date, opts)} · ${eventTime(time)}`;
}

function instant(value: string) { const d = new Date(value); return Number.isFinite(d.getTime()) ? d : null; }
/** An instant's date in Atlanta time ("Nov 13", plus the year when it isn't this year). */
export function instantDate(value: string, opts: { tz?: string; long?: boolean; now?: Date } = {}): string {
  const d = instant(value); if (!d) return BAD;
  const tz = opts.tz ?? ATLANTA_TZ;
  if (opts.long) return new Intl.DateTimeFormat("en-US", { timeZone: tz, weekday: "long", month: "long", day: "numeric", year: "numeric" }).format(d);
  const yr = Number(new Intl.DateTimeFormat("en-US", { timeZone: tz, year: "numeric" }).format(d));
  return new Intl.DateTimeFormat("en-US", { timeZone: tz, month: "short", day: "numeric", year: yr !== currentYear(opts.now ?? new Date()) ? "numeric" : undefined }).format(d);
}
/** An instant's time in Atlanta time: "10:00 AM". */
export function instantTime(value: string, opts: { tz?: string } = {}): string {
  const d = instant(value); if (!d) return "Time unavailable";
  return new Intl.DateTimeFormat("en-US", { timeZone: opts.tz ?? ATLANTA_TZ, hour: "numeric", minute: "2-digit" }).format(d);
}
/** When something happened: "Nov 13, 10:00 AM" (Atlanta time). */
export function timestamp(value: string | null | undefined, opts: { now?: Date } = {}): string {
  if (!value) return "Not available";
  const d = instant(value); if (!d) return "Time unavailable";
  return `${instantDate(value, opts)}, ${instantTime(value)}`;
}

/** "Dec 14" — a month and day, no weekday or year. */
export function monthDay(value: string): string {
  const p = ymd(value); if (!p) return BAD;
  return new Intl.DateTimeFormat("en-US", { timeZone: "UTC", month: "short", day: "numeric" }).format(p.date);
}
/** Today's calendar date in Atlanta as "YYYY-MM-DD". */
export function todayInAtlanta(now: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: ATLANTA_TZ, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}
/** The Monday on or before a calendar date, as "YYYY-MM-DD". */
export function weekStart(value: string): string {
  const p = ymd(value); if (!p) return value;
  const back = (p.date.getUTCDay() + 6) % 7;
  return new Date(p.date.getTime() - back * 86_400_000).toISOString().slice(0, 10);
}
