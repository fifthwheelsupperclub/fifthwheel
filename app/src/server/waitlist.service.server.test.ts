import assert from "node:assert/strict";
import test from "node:test";
import { createWaitlistService } from "./waitlist.service.server.ts";
import { WaitlistRepositoryError } from "./waitlist.repository.server.ts";

const payload = {
  first_name: "Avery",
  last_name: "Chen",
  email: "Avery.Chen@example.test",
  birthdate: "1990-10-12",
  match_age_min: 21,
  match_age_max: 120,
  neighborhood: "Inman Park",
  identity: "Non-binary",
  open_to: "Women, Non-binary people",
  nights: "Friday",
  looking_for: "Open",
  surprise_game: "I'd rather keep it conversational",
  referral: "A friend",
  source: "landing-page",
  submitted_at: "untrusted client timestamp",
  _gotcha: "",
};

test("returns one neutral result for new and duplicate persisted waitlist signups", async () => {
  let calls = 0;
  const results = ["created", "existing"] as const;
  const service = createWaitlistService({
    repository: {
      async insertIfAbsent(intake) {
        assert.equal(intake.matchAgeMax, 120);
        return { kind: results[calls++]!, signup: {} as never };
      },
    },
    now: () => new Date("2026-11-12T17:00:00Z"),
  });

  const created = await service.submit(payload);
  const duplicate = await service.submit(payload);
  assert.deepEqual(created, { ok: true, value: { received: true } });
  assert.deepEqual(duplicate, created);
  assert.equal(calls, 2);
});

test("honeypot uses the same neutral response and never calls persistence", async () => {
  let calls = 0;
  const service = createWaitlistService({
    repository: { async insertIfAbsent() { calls += 1; throw new Error("must not run"); } },
    now: () => new Date("2026-11-12T17:00:00Z"),
  });
  assert.deepEqual(await service.submit({ ...payload, first_name: "", _gotcha: "bot" }), {
    ok: true,
    value: { received: true },
  });
  assert.equal(calls, 0);
});

test("rejects unsupported fields and ages outside 21–120 without persistence", async () => {
  let calls = 0;
  const service = createWaitlistService({
    repository: { async insertIfAbsent() { calls += 1; throw new Error("must not run"); } },
    now: () => new Date("2026-11-12T17:00:00Z"),
  });
  const tooOld = await service.submit({ ...payload, match_age_max: 121 });
  const unknown = await service.submit({ ...payload, unexpected: true });
  assert.equal(tooOld.ok, false);
  if (!tooOld.ok) {
    assert.equal(tooOld.error.code, "validation_failed");
    assert.ok(tooOld.error.fields && "match_age_max" in tooOld.error.fields);
  }
  assert.equal(unknown.ok, false);
  if (!unknown.ok) assert.equal(unknown.error.code, "validation_failed");
  assert.equal(calls, 0);
});

test("maps repository failures to a safe temporary error without leaking provider details", async () => {
  const service = createWaitlistService({
    repository: {
      async insertIfAbsent() { throw new WaitlistRepositoryError("provider_failed"); },
    },
    now: () => new Date("2026-11-12T17:00:00Z"),
  });
  const result = await service.submit(payload);
  assert.deepEqual(result, {
    ok: false,
    error: {
      code: "temporarily_unavailable",
      safeMessage: "We couldn’t receive the form right now. Try again shortly.",
    },
  });
});
