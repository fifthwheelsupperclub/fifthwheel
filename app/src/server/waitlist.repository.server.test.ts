import assert from "node:assert/strict";
import test from "node:test";
import type { ValidatedWaitlistIntake, WaitlistSignupRow } from "./admission.contracts.server.ts";
import {
  createWaitlistRepository,
  WaitlistRepositoryError,
} from "./waitlist.repository.server.ts";
import type { SupabaseServerConfig } from "./supabase.server.ts";

const config: SupabaseServerConfig = {
  url: "http://127.0.0.1:56421",
  publishableKey: "public-test-key",
  secretKey: "server-only-test-secret",
};

const intake: ValidatedWaitlistIntake = {
  firstName: "New",
  lastName: "Signup",
  emailNormalized: "fixture@example.test",
  birthdate: "1990-01-02",
  identity: "Woman",
  openTo: ["Women", "Non-binary people"],
  matchAgeMin: 30,
  matchAgeMax: 42,
  neighborhood: "Inman Park",
  nights: ["Friday", "Saturday"],
  lookingFor: "Open",
  surpriseGame: "Yes, surprise me",
  referral: "Friend",
  source: "landing-page",
};

const existingSignup: WaitlistSignupRow = {
  id: "946c81d0-f5c8-4c81-a7c0-a3e96b08df2e",
  first_name: "Original",
  last_name: "Value",
  email_normalized: "fixture@example.test",
  birthdate: "1988-02-03",
  identity: "Man",
  open_to: ["Men"],
  match_age_min: 32,
  match_age_max: 45,
  neighborhood: "Chamblee",
  nights: ["Wednesday"],
  looking_for: "Casual",
  surprise_game: "I'd rather keep it conversational",
  referral: "Original referral",
  source: "landing-page",
  received_at: "2026-11-01T10:00:00.000Z",
  created_at: "2026-11-01T10:00:00.000Z",
};

function jsonResponse(body: unknown, status = 201): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

test("inserts a validated intake and uses only server-role PostgREST headers", async () => {
  const captured: { url?: URL; init?: RequestInit } = {};
  const repository = createWaitlistRepository(config, async (input, init) => {
    captured.url = new URL(input.toString());
    captured.init = init ?? {};
    return jsonResponse([existingSignup]);
  });

  const result = await repository.insertIfAbsent(intake);

  assert.equal(result.kind, "created");
  assert.deepEqual(result.signup, existingSignup);
  assert.equal(captured.url?.pathname, "/rest/v1/waitlist_signups");
  assert.equal(captured.url?.searchParams.get("on_conflict"), "email_normalized");
  assert.equal(captured.init?.method, "POST");
  const headers = new Headers(captured.init?.headers);
  assert.equal(headers.get("apikey"), config.secretKey);
  assert.equal(headers.get("authorization"), `Bearer ${config.secretKey}`);
  assert.notEqual(headers.get("apikey"), config.publishableKey);
  assert.equal(headers.get("prefer"), "resolution=ignore-duplicates,return=representation");
  assert.equal(headers.get("content-type"), "application/json");
  assert.deepEqual(JSON.parse(String(captured.init?.body)), {
    first_name: intake.firstName,
    last_name: intake.lastName,
    email_normalized: intake.emailNormalized,
    birthdate: intake.birthdate,
    identity: intake.identity,
    open_to: [...intake.openTo],
    match_age_min: intake.matchAgeMin,
    match_age_max: intake.matchAgeMax,
    neighborhood: intake.neighborhood,
    nights: [...intake.nights],
    looking_for: intake.lookingFor,
    surprise_game: intake.surpriseGame,
    referral: intake.referral,
    source: intake.source,
  });
});

test("duplicate normalized email fetches existing intake and never overwrites it", async () => {
  const calls: Array<{ url: URL; init: RequestInit }> = [];
  const repository = createWaitlistRepository(config, async (input, init) => {
    const url = new URL(input.toString());
    calls.push({ url, init: init ?? {} });
    if (init?.method === "POST") return jsonResponse([]);
    return jsonResponse([existingSignup], 200);
  });

  const result = await repository.insertIfAbsent(intake);

  assert.equal(result.kind, "existing");
  assert.deepEqual(result.signup, existingSignup);
  assert.equal(result.signup.first_name, "Original");
  assert.equal(calls.length, 2);
  assert.equal(calls[0].init.method, "POST");
  assert.equal(calls[1].init.method, "GET");
  assert.equal(calls[1].url.searchParams.get("email_normalized"), "eq.fixture@example.test");
  assert.equal(calls[1].url.searchParams.get("limit"), "2");
  assert.match(String(calls[1].url.searchParams.get("select")), /email_normalized/);
});

test("rejects malformed PostgREST rows, failed responses, and network errors safely", async () => {
  const malformed = createWaitlistRepository(config, async () => jsonResponse([{ id: "bad" }]));
  await assert.rejects(
    () => malformed.insertIfAbsent(intake),
    (error: unknown) => error instanceof WaitlistRepositoryError && error.code === "provider_data_invalid",
  );

  const badJson = createWaitlistRepository(config, async () => new Response("not-json", { status: 201 }));
  await assert.rejects(
    () => badJson.insertIfAbsent(intake),
    (error: unknown) => error instanceof WaitlistRepositoryError && error.code === "provider_data_invalid",
  );

  const rejected = createWaitlistRepository(config, async () => new Response("sensitive provider detail", { status: 503 }));
  await assert.rejects(
    () => rejected.insertIfAbsent(intake),
    (error: unknown) => error instanceof WaitlistRepositoryError
      && error.code === "provider_failed"
      && !error.message.includes("sensitive"),
  );

  const offline = createWaitlistRepository(config, async () => { throw new Error("secret network detail"); });
  await assert.rejects(
    () => offline.insertIfAbsent(intake),
    (error: unknown) => error instanceof WaitlistRepositoryError
      && error.code === "provider_failed"
      && !error.message.includes("secret"),
  );
});

test("fails safely when an ignored conflict cannot resolve one existing row", async () => {
  const repository = createWaitlistRepository(config, async (_input, init) => (
    init?.method === "POST" ? jsonResponse([]) : jsonResponse([], 200)
  ));

  await assert.rejects(
    () => repository.insertIfAbsent(intake),
    (error: unknown) => error instanceof WaitlistRepositoryError && error.code === "existing_row_unavailable",
  );
});
