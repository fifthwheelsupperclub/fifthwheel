import assert from "node:assert/strict";
import { test } from "node:test";
import { buildWaitlistImport } from "./waitlist-import.server.ts";

const now = new Date("2026-11-15T12:00:00Z");
const row = (over: Record<string, unknown> = {}) => ({ id: "e0850000-0000-4000-8000-000000000001", email_normalized: "Ada@Example.com", first_name: "Ada", last_name: "O'Neil", birthdate: "1990-01-01",
  identity: "Woman", open_to: ["Men", "Women"], match_age_min: 25, match_age_max: 45, neighborhood: "Inman Park", nights: ["Friday"], referral: "", looking_for: "Open", surprise_game: "Yes, surprise me",
  source: "landing-page", received_at: "2026-10-01T10:00:00Z", ...over });

test("valid rows become one reviewable idempotent insert that keeps ids and times and escapes quotes", () => {
  const r = buildWaitlistImport([row(), row({ id: undefined, email_normalized: "b@example.com", received_at: undefined, nights: undefined })], now);
  assert.equal(r.accepted, 2);
  assert.deepEqual(r.quarantined, []);
  assert.match(r.sql, /^-- Generated waitlist import/);
  assert.match(r.sql, /begin;\ninsert into public\.waitlist_signups/);
  assert.match(r.sql, /on conflict \(email_normalized\) do nothing;\ncommit;/);
  assert.match(r.sql, /'ada@example\.com'/);
  assert.match(r.sql, /'O''Neil'/);
  assert.match(r.sql, /'e0850000-0000-4000-8000-000000000001'/);
  assert.match(r.sql, /gen_random_uuid\(\)/);
  assert.ok(!/admission|invite/i.test(r.sql.replace(/-- It creates no admissions, sends no email/, "")), "import must not create access");
});

test("anything that would need a guess is quarantined with a reason and no personal data", () => {
  const bad: Array<[Record<string, unknown>, RegExp]> = [
    [{ last_name: "" }, /last name missing/], [{ birthdate: undefined, age: 34 }, /never derived from an age/], [{ birthdate: "2020-01-01" }, /under 21/], [{ identity: "Other" }, /identity/],
    [{ open_to: [] }, /open_to/], [{ open_to: ["Aliens"] }, /open_to/], [{ match_age_min: 19 }, /age range/], [{ match_age_max: 130 }, /age range/], [{ looking_for: "Marriage" }, /looking_for/],
    [{ email_normalized: "nope" }, /email/], [{ id: "123" }, /UUID/], [{ received_at: "yesterday" }, /received_at/], [{ neighborhood: "Bad\u0000Place" }, /neighborhood/],
  ];
  for (const [over, pattern] of bad) {
    const r = buildWaitlistImport([row(over)], now);
    assert.equal(r.accepted, 0, JSON.stringify(over));
    assert.match(r.quarantined[0].reason, pattern, JSON.stringify(over));
    assert.ok(!JSON.stringify(r.quarantined).includes("Ada"), "report leaked personal data");
    assert.match(r.sql, /nothing to import/);
  }
  const dup = buildWaitlistImport([row(), row({ id: undefined, email_normalized: "ada@example.com" })], now);
  assert.equal(dup.accepted, 1);
  assert.match(dup.quarantined[0].reason, /duplicate email/);
  assert.throws(() => buildWaitlistImport({}, now));
});
