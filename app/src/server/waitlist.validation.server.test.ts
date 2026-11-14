import assert from "node:assert/strict";
import test from "node:test";
import { validateWaitlistIntake } from "./waitlist.validation.server.ts";

const fixture = {
  first_name: " Avery ",
  last_name: " Chen ",
  email: " Avery.Chen@Example.Test ",
  birthdate: "1990-10-12",
  match_age_min: 25,
  match_age_max: 45,
  neighborhood: "Inman Park",
  identity: "Non-binary",
  open_to: "Women, Non-binary people",
  nights: "Friday, Saturday",
  looking_for: "Open",
  surprise_game: "I'd rather keep it conversational",
  referral: "A friend",
  source: "landing-page",
  submitted_at: "not trusted for ordering",
  _gotcha: "",
};

test("preserves marketing fields, normalizes email, maps optional nights and ignores submitted_at", () => {
  const result = validateWaitlistIntake(fixture, new Date("2026-11-12T17:00:00Z"));
  assert.equal(result.kind, "valid");
  if (result.kind !== "valid") return;
  assert.deepEqual(result.value, {
    firstName: "Avery",
    lastName: "Chen",
    emailNormalized: "avery.chen@example.test",
    birthdate: "1990-10-12",
    identity: "Non-binary",
    openTo: ["Women", "Non-binary people"],
    matchAgeMin: 25,
    matchAgeMax: 45,
    neighborhood: "Inman Park",
    nights: ["Friday", "Saturday"],
    lookingFor: "Open",
    surpriseGame: "I'd rather keep it conversational",
    referral: "A friend",
    source: "landing-page",
  });
});

test("accepts each of the seven non-empty preference sets without collapsing them", () => {
  const all = ["Women", "Men", "Non-binary people"];
  for (let mask = 1; mask < 8; mask += 1) {
    const selected = all.filter((_, index) => (mask & (1 << index)) !== 0);
    const result = validateWaitlistIntake({ ...fixture, open_to: selected.join(", ") }, new Date("2026-11-12T17:00:00Z"));
    assert.equal(result.kind, "valid", `expected to accept ${selected.join(" + ")}`);
    if (result.kind === "valid") assert.deepEqual(result.value.openTo, selected);
  }
});

test("rejects unknown or duplicate selections and maps Not specified to no selected nights", () => {
  assert.equal(validateWaitlistIntake({ ...fixture, open_to: "Women, Everyone" }).kind, "invalid");
  assert.equal(validateWaitlistIntake({ ...fixture, open_to: "Women, Women" }).kind, "invalid");
  const result = validateWaitlistIntake({ ...fixture, nights: "Not specified" }, new Date("2026-11-12T17:00:00Z"));
  assert.equal(result.kind, "valid");
  if (result.kind === "valid") assert.deepEqual(result.value.nights, []);
});

test("requires valid payload and keeps the honeypot neutral without validation", () => {
  assert.equal(validateWaitlistIntake({ ...fixture, first_name: "", _gotcha: "bot" }).kind, "honeypot");
  assert.deepEqual(validateWaitlistIntake(null), {
    kind: "invalid",
    fields: { form: "Submit a valid waitlist form." },
  });
});

test("checks real dates and the 21st birthday against Atlanta's local date", () => {
  const beforeAtlantaMidnightButAfterUtcMidnight = new Date("2026-11-12T04:30:00Z");
  assert.equal(validateWaitlistIntake({ ...fixture, birthdate: "2005-11-12" }, beforeAtlantaMidnightButAfterUtcMidnight).kind, "invalid");
  assert.equal(validateWaitlistIntake({ ...fixture, birthdate: "2005-11-11" }, beforeAtlantaMidnightButAfterUtcMidnight).kind, "valid");
  assert.equal(validateWaitlistIntake({ ...fixture, birthdate: "2005-11-12" }, new Date("2026-11-12T05:00:00Z")).kind, "valid");
  assert.equal(validateWaitlistIntake({ ...fixture, birthdate: "2001-02-29" }, new Date("2026-11-12T17:00:00Z")).kind, "invalid");
  assert.equal(validateWaitlistIntake({ ...fixture, birthdate: "2030-01-01" }, new Date("2026-11-12T17:00:00Z")).kind, "invalid");
  assert.equal(validateWaitlistIntake({ ...fixture, birthdate: "2004-02-29" }, new Date("2026-02-28T17:00:00Z")).kind, "valid");
});

test("preserves four-digit DOB years below 0100 instead of remapping to 1900s", () => {
  assert.equal(validateWaitlistIntake({ ...fixture, birthdate: "0001-02-03" }, new Date("2026-11-12T17:00:00Z")).kind, "valid");
  assert.equal(validateWaitlistIntake({ ...fixture, birthdate: "0099-02-29" }, new Date("2026-11-12T17:00:00Z")).kind, "invalid");
});

test("bounds fields, requires exact source and rejects malformed age ranges", () => {
  const invalid = validateWaitlistIntake({
    ...fixture,
    first_name: "A".repeat(101),
    referral: "x".repeat(1001),
    source: "client-supplied",
    match_age_min: 48,
    match_age_max: 47,
  });
  assert.equal(invalid.kind, "invalid");
  if (invalid.kind === "invalid") {
    assert.ok("first_name" in invalid.fields);
    assert.ok("referral" in invalid.fields);
    assert.ok("source" in invalid.fields);
    assert.ok("match_age_max" in invalid.fields);
  }
});

test("accepts matching ages from 21 through 120 and rejects values outside that range", () => {
  assert.equal(validateWaitlistIntake({ ...fixture, match_age_min: 21, match_age_max: 21 }).kind, "valid");
  assert.equal(validateWaitlistIntake({ ...fixture, match_age_min: 120, match_age_max: 120 }).kind, "valid");
  assert.equal(validateWaitlistIntake({ ...fixture, match_age_min: 121, match_age_max: 121 }).kind, "invalid");
  assert.equal(validateWaitlistIntake({ ...fixture, match_age_min: 21, match_age_max: 121 }).kind, "invalid");
  assert.equal(validateWaitlistIntake({ ...fixture, match_age_min: "21.5", match_age_max: "45" }).kind, "invalid");
  assert.equal(validateWaitlistIntake({ ...fixture, match_age_min: Number.MAX_SAFE_INTEGER + 1, match_age_max: 45 }).kind, "invalid");
});
