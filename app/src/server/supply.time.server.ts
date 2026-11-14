/** Strict Atlanta local date/time conversion; gaps and folds require operator correction. */

const datePattern = /^(\d{4})-(\d{2})-(\d{2})$/;
const timePattern = /^(\d{2}):(\d{2})$/;
const atlantaFormatter = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit",
  hour: "2-digit", minute: "2-digit", hourCycle: "h23",
});

export type LocalDateTimeResult =
  | Readonly<{ ok: true; instant: string }>
  | Readonly<{ ok: false; code: "invalid_date" | "invalid_time" | "nonexistent_local_time" | "ambiguous_local_time" }>;

function isValidDate(year: number, month: number, day: number): boolean {
  const value = new Date(0);
  value.setUTCHours(0, 0, 0, 0);
  value.setUTCFullYear(year, month - 1, day);
  return value.getUTCFullYear() === year && value.getUTCMonth() === month - 1 && value.getUTCDate() === day;
}

function partsAt(instant: number): Readonly<{ year: number; month: number; day: number; hour: number; minute: number }> {
  const parts = atlantaFormatter.formatToParts(new Date(instant));
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return { year: Number(values.year), month: Number(values.month), day: Number(values.day), hour: Number(values.hour), minute: Number(values.minute) };
}

function wallClockScalar(part: Readonly<{ year: number; month: number; day: number; hour: number; minute: number }>): number {
  const value = new Date(0);
  value.setUTCHours(part.hour, part.minute, 0, 0);
  value.setUTCFullYear(part.year, part.month - 1, part.day);
  return value.getTime();
}

export function atlantaLocalDateTime(date: string, time: string): LocalDateTimeResult {
  const dateMatch = datePattern.exec(date);
  if (!dateMatch) return { ok: false, code: "invalid_date" };
  const [, y, m, d] = dateMatch;
  const year = Number(y), month = Number(m), day = Number(d);
  if (!isValidDate(year, month, day)) return { ok: false, code: "invalid_date" };
  const timeMatch = timePattern.exec(time);
  if (!timeMatch || Number(timeMatch[1]) > 23 || Number(timeMatch[2]) > 59) return { ok: false, code: "invalid_time" };
  const hour = Number(timeMatch[1]), minute = Number(timeMatch[2]);
  const wallClockUtc = new Date(0);
  wallClockUtc.setUTCHours(hour, minute, 0, 0);
  wallClockUtc.setUTCFullYear(year, month - 1, day);
  const target = wallClockUtc.getTime();
  const offsets = new Set<number>();
  // Discover the zone offsets around this date, including both sides of a DST transition.
  for (let sample = target - 36 * 60 * 60_000; sample <= target + 36 * 60 * 60_000; sample += 6 * 60 * 60_000) {
    const part = partsAt(sample);
    const representedWallTime = wallClockScalar(part);
    offsets.add(representedWallTime - sample);
  }
  const matches: number[] = [];
  for (const offset of offsets) {
    const candidate = target - offset;
    const part = partsAt(candidate);
    if (part.year === year && part.month === month && part.day === day && part.hour === hour && part.minute === minute) matches.push(candidate);
  }
  if (matches.length === 0) return { ok: false, code: "nonexistent_local_time" };
  if (matches.length > 1) return { ok: false, code: "ambiguous_local_time" };
  return { ok: true, instant: new Date(matches[0]!).toISOString() };
}
