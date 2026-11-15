import assert from "node:assert/strict";
import test from "node:test";
import { createSupabaseServerClient, SupabaseServerError } from "./supabase.server.ts";

const userId = "3d7d1b79-b06e-43c4-85f4-9b222d7cecc7";
const config = {
  url: "http://127.0.0.1:56421",
  publishableKey: "local-publishable-key",
  secretKey: "local-server-secret-key",
};

test("verifies Auth first and reads roles/admissions with the server-only key", async () => {
  const requests: Array<{ url: URL; init?: RequestInit }> = [];
  const bodies = [
    {
      id: userId,
      email: " Member@Example.test ",
      email_confirmed_at: "2026-11-12T12:00:00Z",
      user_metadata: { role: "admin", staffRoles: ["admin"] },
    },
    [{ user_id: userId, role: "host" }],
    [{ state: "activated", auth_user_id: userId, email_normalized: "member@example.test" }],
  ];
  const fakeFetch: typeof fetch = async (input, init) => {
    requests.push({ url: new URL(String(input)), init });
    const body = bodies.shift();
    assert.notEqual(body, undefined);
    return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
  };

  const client = createSupabaseServerClient(config, fakeFetch);
  const identity = await client.verifyAccessToken("verified-access-token");
  assert.deepEqual(identity, {
    authUserId: userId,
    emailNormalized: "member@example.test",
    emailVerified: true,
  });

  const facts = await client.readTrustedAuthorizationFacts(userId);
  assert.deepEqual(facts.staffRoles, ["host"]);
  assert.deepEqual(facts.admission, {
    state: "activated",
    authUserId: userId,
    emailNormalized: "member@example.test",
  });

  assert.equal(requests[0].url.pathname, "/auth/v1/user");
  assert.equal(new Headers(requests[0].init?.headers).get("apikey"), config.publishableKey);
  assert.equal(new Headers(requests[0].init?.headers).get("authorization"), "Bearer verified-access-token");
  for (const request of requests.slice(1)) {
    assert.equal(new Headers(request.init?.headers).get("apikey"), config.secretKey);
    assert.equal(new Headers(request.init?.headers).get("authorization"), `Bearer ${config.secretKey}`);
  }
  for (const request of requests) assert.equal(request.init?.signal instanceof AbortSignal, true);
  assert.equal(requests[1].url.pathname, "/rest/v1/app_user_roles");
  assert.equal(requests[1].url.searchParams.get("user_id"), `eq.${userId}`);
  assert.equal(requests[2].url.pathname, "/rest/v1/app_admissions");
  assert.equal(requests[2].url.searchParams.get("auth_user_id"), `eq.${userId}`);
});

test("ignores Auth user_metadata and rejects an unverified token without querying trusted tables", async () => {
  let calls = 0;
  const fakeFetch: typeof fetch = async () => {
    calls += 1;
    return new Response(JSON.stringify({ error: "invalid token" }), { status: 401 });
  };
  const client = createSupabaseServerClient(config, fakeFetch);
  assert.equal(await client.verifyAccessToken("expired-token"), null);
  assert.equal(calls, 1);
});

test("rejects non-loopback HTTP configuration and malformed trusted role rows", async () => {
  assert.throws(
    () => createSupabaseServerClient({ ...config, url: "http://remote.example.test" }, async () => new Response()),
    (error: unknown) => error instanceof SupabaseServerError && error.code === "configuration_invalid",
  );

  const invalidRows = [{ unexpected: "admin" }];
  const fakeFetch: typeof fetch = async () => new Response(JSON.stringify(invalidRows), { status: 200 });
  const client = createSupabaseServerClient(config, fakeFetch);
  await assert.rejects(
    () => client.readTrustedAuthorizationFacts(userId),
    (error: unknown) => error instanceof SupabaseServerError && error.code === "trusted_data_invalid",
  );
});
