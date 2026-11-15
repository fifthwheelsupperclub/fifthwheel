import assert from "node:assert/strict";
import test from "node:test";
import {
  createWaitlistSearchRepository,
  WaitlistSearchRepositoryError,
} from "./waitlist.search.repository.server.ts";
import type { SupabaseServerConfig } from "./supabase.server.ts";

const config: SupabaseServerConfig = {
  url: "http://127.0.0.1:57421",
  publishableKey: "test-public-key",
  secretKey: "test-server-secret",
};

const signupA = "2c8f7a9d-295f-4e5d-9fb0-a9cc5c8a19f0";
const signupB = "a80394c5-23d2-4c3f-b84d-eec48222ad62";
const signupC = "946c81d0-f5c8-4c81-a7c0-a3e96b08df31";
const admissionA = "5f4836d7-4f52-44cb-83a3-f035b792a0ab";
const deliveryA = "7f7c9d27-22c6-4d6f-9307-f9d4ba7f59b1";
const deliveryOlder = "87fbd54f-e013-461f-85f5-f83f33805dfc";
const atA = "2026-11-12T12:00:00.123456Z";
const atB = "2026-11-12T11:00:00.654321Z";
const atC = "2026-11-12T10:00:00Z";

function waitlistRow(id: string, receivedAt: string, overrides: Record<string, unknown> = {}) {
  return {
    id,
    first_name: "Casey",
    last_name: "Example",
    email_normalized: "casey@example.test",
    neighborhood: "Inman Park",
    identity: "Woman",
    open_to: ["Women", "Non-binary people"],
    received_at: receivedAt,
    // Deliberately included to prove PostgREST projection is narrower than the table.
    birthdate: "1990-01-01",
    referral: "private field not selected",
    ...overrides,
  };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

function cursor(receivedAt: string, id: string): string {
  return Buffer.from(JSON.stringify({ receivedAt, id })).toString("base64url");
}

test("searches with bounded filters, keyset pagination, minimal DTO and latest invitation state", async () => {
  const calls: Array<{ url: URL; init: RequestInit }> = [];
  const repository = createWaitlistSearchRepository(config, async (input, init) => {
    const url = new URL(input.toString());
    calls.push({ url, init: init ?? {} });
    if (url.pathname === "/rest/v1/waitlist_signups") {
      return jsonResponse([
        waitlistRow(signupA, atA),
        waitlistRow(signupB, atB, { first_name: "Sam", last_name: "Stone", email_normalized: "sam@example.test" }),
        waitlistRow(signupC, atC),
      ]);
    }
    return jsonResponse([{
      id: admissionA,
      waitlist_signup_id: signupA,
      state: "invited",
      app_invitation_deliveries: [
        {
          id: deliveryA,
          admission_id: admissionA,
          state: "accepted",
          queued_at: atA,
          accepted_at: atA,
          delivered_at: null,
          next_attempt_at: atA,
        },
        {
          id: deliveryOlder,
          admission_id: admissionA,
          state: "failed",
          queued_at: atB,
          accepted_at: null,
          delivered_at: null,
          next_attempt_at: atB,
        },
      ],
    }]);
  });

  const result = await repository.search({
    query: 'casey%,"),injected(',
    neighborhood: "Inman Park",
    limit: 2,
  });

  assert.equal(result.rows.length, 2);
  assert.equal(result.nextCursor, cursor(atB, signupB));
  assert.deepEqual(result.rows[0], {
    id: signupA,
    firstName: "Casey",
    lastName: "Example",
    emailNormalized: "casey@example.test",
    neighborhood: "Inman Park",
    identity: "Woman",
    openTo: ["Women", "Non-binary people"],
    receivedAt: atA,
    admissionState: "invited",
    latestDelivery: {
      id: deliveryA,
      state: "accepted",
      queuedAt: atA,
      acceptedAt: atA,
      deliveredAt: null,
      nextAttemptAt: atA,
    },
  });
  assert.equal("birthdate" in result.rows[0], false);
  assert.equal("referral" in result.rows[0], false);
  assert.equal(result.rows[1].admissionState, "none");
  assert.equal(result.rows[1].latestDelivery, null);

  assert.equal(calls.length, 2);
  const pageCall = calls[0];
  assert.equal(pageCall.url.searchParams.get("order"), "received_at.desc,id.desc");
  assert.equal(pageCall.url.searchParams.get("limit"), "3");
  assert.equal(pageCall.url.searchParams.get("neighborhood"), "eq.Inman Park");
  const searchFilter = pageCall.url.searchParams.get("or");
  assert.ok(searchFilter?.startsWith("("));
  assert.ok(searchFilter?.includes("first_name.ilike."));
  assert.ok(searchFilter?.includes("\\%"), "percent wildcard input should be escaped");
  assert.ok(searchFilter?.includes("\\\""), "quotes should be escaped inside the PostgREST filter");
  assert.equal(pageCall.url.searchParams.get("select")?.includes("birthdate"), false);
  assert.equal(pageCall.url.searchParams.get("select")?.includes("referral"), false);

  const admissionCall = calls[1];
  assert.equal(admissionCall.url.pathname, "/rest/v1/app_admissions");
  assert.equal(admissionCall.url.searchParams.get("waitlist_signup_id"), `in.(${signupA},${signupB})`);
  assert.equal(admissionCall.url.searchParams.get("app_invitation_deliveries.limit"), "2");
  assert.equal(admissionCall.url.searchParams.get("app_invitation_deliveries.order"), "queued_at.desc,id.desc");
  for (const call of calls) {
    assert.equal(call.init.method, "GET");
    const headers = new Headers(call.init.headers);
    assert.equal(headers.get("apikey"), config.secretKey);
    assert.equal(headers.get("authorization"), `Bearer ${config.secretKey}`);
    assert.notEqual(headers.get("apikey"), config.publishableKey);
  }
});

test("combines search and cursor disjunctions and advances to the next stable page", async () => {
  const calls: URL[] = [];
  const repository = createWaitlistSearchRepository(config, async (input) => {
    const url = new URL(input.toString());
    calls.push(url);
    if (url.pathname === "/rest/v1/waitlist_signups") {
      return jsonResponse([waitlistRow(signupC, atC)]);
    }
    return jsonResponse([]);
  });

  const result = await repository.search({ query: "casey", cursor: cursor(atB, signupB), limit: 5 });
  assert.equal(result.rows.length, 1);
  assert.equal(result.nextCursor, null);
  const combined = calls[0].searchParams.get("and");
  assert.ok(combined?.includes("or(first_name.ilike."));
  assert.ok(combined?.includes(`or(received_at.lt.${atB},and(received_at.eq.${atB},id.lt.${signupB}))`));
});

test("rejects unsafe or invalid filters and cursors before making a request", async () => {
  let calls = 0;
  const repository = createWaitlistSearchRepository(config, async () => {
    calls += 1;
    return jsonResponse([]);
  });
  const invalidInputs = [
    { limit: 0 },
    { limit: 101 },
    { limit: 2.5 },
    { limit: 1, neighborhood: "Inman Park),id.neq.00000000-0000-0000-0000-000000000000" },
    { limit: 1, cursor: "not-a-cursor" },
    { limit: 1, cursor: cursor("2026-11-12T12:00:00Z", "not-a-uuid") },
    { limit: 1, cursor: cursor("2026-02-30T12:00:00Z", signupA) },
    { limit: 1, query: "bad\nquery" },
  ];
  for (const input of invalidInputs) {
    await assert.rejects(
      () => repository.search(input as Parameters<typeof repository.search>[0]),
      (error: unknown) => error instanceof WaitlistSearchRepositoryError && error.code === "validation_failed",
    );
  }
  assert.equal(calls, 0);
});

test("rejects malformed page, admission and delivery rows without leaking provider data", async () => {
  const invalidResponses: Array<(url: URL) => Response> = [
    () => jsonResponse([{ id: "bad" }]),
    (url) => url.pathname === "/rest/v1/waitlist_signups"
      ? jsonResponse([waitlistRow(signupA, atA)])
      : jsonResponse([{ id: admissionA, waitlist_signup_id: signupA, state: "invited", app_invitation_deliveries: [{ id: deliveryA, admission_id: "wrong", state: "queued" }] }]),
    (url) => url.pathname === "/rest/v1/waitlist_signups"
      ? jsonResponse([waitlistRow(signupA, atA)])
      : jsonResponse([
        { id: admissionA, waitlist_signup_id: signupA, state: "invited", app_invitation_deliveries: [] },
        { id: admissionA, waitlist_signup_id: signupA, state: "invited", app_invitation_deliveries: [] },
      ]),
    () => new Response("sensitive server data", { status: 502 }),
  ];

  for (const respond of invalidResponses) {
    const repository = createWaitlistSearchRepository(config, async (input) => respond(new URL(input.toString())));
    await assert.rejects(
      () => repository.search({ limit: 2 }),
      (error: unknown) => error instanceof WaitlistSearchRepositoryError
        && !error.message.includes("sensitive")
        && ["provider_data_invalid", "provider_failed"].includes(error.code),
    );
  }
});

test("returns an empty page without an admission fetch", async () => {
  let calls = 0;
  const repository = createWaitlistSearchRepository(config, async () => {
    calls += 1;
    return jsonResponse([]);
  });
  const result = await repository.search({ limit: 10 });
  assert.deepEqual(result, { rows: [], nextCursor: null });
  assert.equal(calls, 1);
});
