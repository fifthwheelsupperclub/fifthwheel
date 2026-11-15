/** Turns a reviewed export of the marketing waitlist into SQL for the new project. Output only: it never connects, never creates admissions and never sends anything. */

export type ImportReport = Readonly<{ sql: string; accepted: number; quarantined: ReadonlyArray<Readonly<{ index: number; reason: string }>> }>;

const identities = new Set(["Woman", "Man", "Non-binary"]);
const lookingFor = new Set(["Casual", "Open", "Relationship"]);
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const text = (v: unknown, max: number, min = 1): string | null => (typeof v === "string" && v.trim().length >= min && v.length <= max && !/[\u0000-\u001f\u007f]/.test(v) ? v.trim() : null);
const lit = (v: string) => `'${v.replaceAll("'", "''")}'`;
const arr = (v: readonly string[]) => (v.length === 0 ? "'{}'::text[]" : `ARRAY[${v.map(lit).join(",")}]::text[]`);

function strings(v: unknown, max: number, allowed?: Set<string>): string[] | null {
  if (!Array.isArray(v) || v.length > max) return null;
  const out = v.map((x) => text(x, 80));
  return out.every((x): x is string => x !== null && (!allowed || allowed.has(x))) ? [...new Set(out)] : null;
}
function age21(birthdate: string, now: Date): boolean {
  const [y, m, d] = birthdate.split("-").map(Number);
  const cutoff = new Date(Date.UTC(now.getUTCFullYear() - 21, now.getUTCMonth(), now.getUTCDate()));
  return Date.UTC(y, m - 1, d) <= cutoff.getTime();
}
function instant(v: unknown): string | null { return typeof v === "string" && Number.isFinite(Date.parse(v)) ? new Date(v).toISOString() : null; }

export function buildWaitlistImport(rows: unknown, now = new Date()): ImportReport {
  if (!Array.isArray(rows)) throw new Error("export must be a JSON array");
  const quarantined: Array<{ index: number; reason: string }> = [];
  const seen = new Set<string>();
  const values: string[] = [];
  rows.forEach((raw, index) => {
    const fail = (reason: string) => { quarantined.push({ index, reason }); };
    const r = raw as Record<string, unknown>;
    if (typeof r !== "object" || r === null || Array.isArray(r)) return fail("not an object");
    const emailRaw = text(r.email_normalized ?? r.email, 320, 3);
    const email = emailRaw?.toLowerCase() ?? null;
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return fail("email missing or malformed");
    if (seen.has(email)) return fail("duplicate email in export");
    const first = text(r.first_name, 100), last = text(r.last_name, 100);
    if (!first) return fail("first name missing");
    if (!last) return fail("last name missing (do not invent one)");
    const birthdate = typeof r.birthdate === "string" && /^\d{4}-\d{2}-\d{2}$/.test(r.birthdate) && !Number.isNaN(Date.parse(`${r.birthdate}T00:00:00Z`)) ? r.birthdate : null;
    if (!birthdate) return fail("birthdate missing (never derived from an age)");
    if (!age21(birthdate, now)) return fail("under 21");
    const identity = text(r.identity, 20);
    if (!identity || !identities.has(identity)) return fail("identity not one of the three allowed values");
    const openTo = strings(r.open_to, 3, new Set(["Women", "Men", "Non-binary people"]));
    if (!openTo || openTo.length === 0) return fail("open_to missing or invalid");
    const min = Number(r.match_age_min), max = Number(r.match_age_max);
    if (!Number.isInteger(min) || !Number.isInteger(max) || min < 21 || max > 120 || max < min) return fail("match age range invalid");
    const neighborhood = text(r.neighborhood, 120), looking = text(r.looking_for, 20), surprise = text(r.surprise_game, 60);
    if (!neighborhood) return fail("neighborhood missing");
    if (!looking || !lookingFor.has(looking)) return fail("looking_for invalid");
    if (!surprise) return fail("surprise_game missing");
    const nights = r.nights === undefined ? [] : strings(r.nights, 10);
    if (!nights) return fail("nights invalid");
    const referral = r.referral === undefined || r.referral === null || r.referral === "" ? "" : text(r.referral, 200);
    if (referral === null) return fail("referral invalid");
    const source = r.source === undefined ? "landing-page" : text(r.source, 80);
    if (!source) return fail("source invalid");
    const id = r.id === undefined ? null : typeof r.id === "string" && uuid.test(r.id) ? r.id.toLowerCase() : "bad";
    if (id === "bad") return fail("id is not a UUID");
    const received = r.received_at === undefined ? null : instant(r.received_at);
    if (r.received_at !== undefined && !received) return fail("received_at invalid");
    seen.add(email);
    values.push(`(${[id ? lit(id) : "gen_random_uuid()", lit(email), lit(first), lit(last), `${lit(birthdate)}::date`, lit(identity), arr(openTo), String(min), String(max), lit(neighborhood),
      arr(nights), lit(referral), lit(looking), lit(surprise), lit(source), received ? `${lit(received)}::timestamptz` : "now()"].join(",")})`);
  });
  const sql = values.length === 0 ? "-- nothing to import\n" : [
    "-- Generated waitlist import. Review, then run once in a transaction against the NEW project. Existing emails are left untouched.",
    "-- It creates no admissions, sends no email and grants no access.",
    "begin;",
    "insert into public.waitlist_signups(id,email_normalized,first_name,last_name,birthdate,identity,open_to,match_age_min,match_age_max,neighborhood,nights,referral,looking_for,surprise_game,source,received_at) values",
    values.join(",\n"),
    "on conflict (email_normalized) do nothing;",
    "commit;", ""].join("\n");
  return { sql, accepted: values.length, quarantined };
}
