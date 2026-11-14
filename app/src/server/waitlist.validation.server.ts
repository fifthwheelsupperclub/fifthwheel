import type {
  MarketingOpenTo,
  MarketingWaitlistPayload,
  SurpriseGame,
  ValidatedWaitlistIntake,
  WaitlistIdentity,
  Weekday,
} from "./admission.contracts.server.ts";

export type WaitlistIntakeValidation =
  | Readonly<{ kind: "honeypot" }>
  | Readonly<{ kind: "invalid"; fields: Readonly<Record<string, string>> }>
  | Readonly<{ kind: "valid"; value: ValidatedWaitlistIntake }>;

const identities = new Set<WaitlistIdentity>(["Woman", "Man", "Non-binary"]);
const openToValues = ["Women", "Men", "Non-binary people"] as const satisfies readonly MarketingOpenTo[];
const weekdays = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"] as const satisfies readonly Weekday[];
const lookingForValues = ["Casual", "Open", "Relationship"] as const;
const surpriseGameValues = ["Yes, surprise me", "I'd rather keep it conversational"] as const satisfies readonly SurpriseGame[];
const neighborhoods = new Set(["Inman Park", "Chamblee", "Virginia Highlands"]);
const maximumMatchAge = 120;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" ? value.trim() : null;
}

function addError(errors: Record<string, string>, key: string, message: string): void {
  if (!(key in errors)) errors[key] = message;
}

function parseDate(value: string | null): Readonly<{ year: number; month: number; day: number }> | null {
  if (!value) return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  // Date.UTC remaps years 0–99 to 1900–1999. Preserve the submitted four-digit year.
  const date = new Date(0);
  date.setUTCHours(0, 0, 0, 0);
  date.setUTCFullYear(year, month - 1, day);
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
  return { year, month, day };
}

function atlantaDate(now: Date): Readonly<{ year: number; month: number; day: number }> {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const part = (type: "year" | "month" | "day") => parts.find((item) => item.type === type)?.value;
  return { year: Number(part("year")), month: Number(part("month")), day: Number(part("day")) };
}

function isAtLeastTwentyOne(
  birth: Readonly<{ year: number; month: number; day: number }>,
  today: Readonly<{ year: number; month: number; day: number }>,
): boolean {
  const age = today.year - birth.year - (
    today.month < birth.month || (today.month === birth.month && today.day < birth.day) ? 1 : 0
  );
  return age >= 21;
}

function parseWholeAge(value: unknown): number | null {
  if (typeof value === "number") return Number.isSafeInteger(value) ? value : null;
  if (typeof value !== "string" || !/^\d+$/.test(value.trim())) return null;
  const parsed = Number(value.trim());
  return Number.isSafeInteger(parsed) ? parsed : null;
}

function parseSelectionSet<T extends string>(
  value: unknown,
  allowed: readonly T[],
  field: string,
  errors: Record<string, string>,
  required: boolean,
): readonly T[] {
  const raw = stringValue(value);
  if (raw === null) {
    addError(errors, field, "Choose valid options.");
    return [];
  }
  if (raw === "Not specified" && field === "nights") return [];
  const selected = raw === "" ? [] : raw.split(",").map((entry) => entry.trim());
  if (required && selected.length === 0) addError(errors, field, "Choose at least one option.");
  const seen = new Set<string>();
  for (const item of selected) {
    if (!allowed.includes(item as T)) addError(errors, field, "Choose valid options.");
    if (seen.has(item)) addError(errors, field, "Remove duplicate options.");
    seen.add(item);
  }
  return selected.filter((item, index, rows) => allowed.includes(item as T) && rows.indexOf(item) === index) as T[];
}

function isOneOf<T extends string>(value: string | null, allowed: readonly T[]): value is T {
  return value !== null && allowed.includes(value as T);
}

/**
 * Parse the unchanged marketing JSON payload. The server's clock is authoritative
 * for Atlanta's local date; client submitted_at is intentionally ignored.
 */
export function validateWaitlistIntake(
  payload: unknown,
  now: Date = new Date(),
): WaitlistIntakeValidation {
  if (!isRecord(payload)) return { kind: "invalid", fields: { form: "Submit a valid waitlist form." } };

  const gotcha = payload._gotcha;
  if (gotcha !== undefined && gotcha !== null && gotcha !== false && gotcha !== "" && gotcha !== 0) {
    return { kind: "honeypot" };
  }

  const errors: Record<string, string> = {};
  const firstName = stringValue(payload.first_name);
  const lastName = stringValue(payload.last_name);
  const emailRaw = stringValue(payload.email);
  const birthdate = stringValue(payload.birthdate);
  const neighborhood = stringValue(payload.neighborhood);
  const identityRaw = stringValue(payload.identity);
  const lookingFor = stringValue(payload.looking_for);
  const surpriseGame = stringValue(payload.surprise_game);
  const referral = payload.referral === undefined ? "" : stringValue(payload.referral);
  const source = stringValue(payload.source);

  if (!firstName) addError(errors, "first_name", "Add your first name.");
  else if (firstName.length > 100) addError(errors, "first_name", "First name is too long.");
  if (!lastName) addError(errors, "last_name", "Add your last name.");
  else if (lastName.length > 100) addError(errors, "last_name", "Last name is too long.");

  const emailNormalized = emailRaw?.toLowerCase() ?? "";
  if (!emailRaw || emailRaw.length > 320 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailRaw)) {
    addError(errors, "email", "Enter a valid email address.");
  }

  const birth = parseDate(birthdate);
  if (!birth) addError(errors, "birthdate", "Enter a valid date of birth.");
  else if (!isAtLeastTwentyOne(birth, atlantaDate(now))) addError(errors, "birthdate", "You must be 21 or older to join.");

  const identity = identityRaw !== null && identities.has(identityRaw as WaitlistIdentity)
    ? identityRaw as WaitlistIdentity
    : null;
  if (!identity) addError(errors, "identity", "Choose a valid identity.");

  const openTo = parseSelectionSet(payload.open_to, openToValues, "open_to", errors, true);
  const nights = parseSelectionSet(payload.nights, weekdays, "nights", errors, false);

  const matchAgeMin = parseWholeAge(payload.match_age_min);
  const matchAgeMax = parseWholeAge(payload.match_age_max);
  if (matchAgeMin === null || matchAgeMin < 21 || matchAgeMin > maximumMatchAge) {
    addError(errors, "match_age_min", "Enter an age from 21 to 120.");
  }
  if (matchAgeMax === null || matchAgeMax < 21 || matchAgeMax > maximumMatchAge) {
    addError(errors, "match_age_max", "Enter an age from 21 to 120.");
  }
  if (matchAgeMin !== null && matchAgeMax !== null && matchAgeMax < matchAgeMin) {
    addError(errors, "match_age_max", "The oldest age must be at least the youngest age.");
  }

  if (!neighborhood || !neighborhoods.has(neighborhood)) addError(errors, "neighborhood", "Choose a valid neighborhood.");
  if (!isOneOf(lookingFor, lookingForValues)) addError(errors, "looking_for", "Choose what you are looking for.");
  if (!isOneOf(surpriseGame, surpriseGameValues)) addError(errors, "surprise_game", "Choose a valid option.");
  if (referral === null || referral.length > 1000) addError(errors, "referral", "Referral must be 1,000 characters or fewer.");
  if (source !== "landing-page") addError(errors, "source", "Use the marketing landing-page source.");

  if (Object.keys(errors).length > 0) return { kind: "invalid", fields: Object.freeze(errors) };
  return {
    kind: "valid",
    value: Object.freeze({
      firstName: firstName!,
      lastName: lastName!,
      emailNormalized,
      birthdate: birthdate!,
      identity: identity!,
      openTo: openTo as [MarketingOpenTo, ...MarketingOpenTo[]],
      matchAgeMin: matchAgeMin!,
      matchAgeMax: matchAgeMax!,
      neighborhood: neighborhood!,
      nights,
      lookingFor: lookingFor as ValidatedWaitlistIntake["lookingFor"],
      surpriseGame: surpriseGame as SurpriseGame,
      referral: referral!,
      source: "landing-page",
    }),
  };
}

// Retain a named payload alias for consumers building request parsers without
// narrowing imported database records into untrusted request data.
export type UntrustedMarketingPayload = MarketingWaitlistPayload;
