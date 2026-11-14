import assert from "node:assert/strict";
import test from "node:test";
import { createSignOutPostHandler } from "./auth.sign-out.http.server.ts";

const appOrigin = "http://127.0.0.1:8085";
const accessToken = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ1c2VyIn0.signature_value-123";
const refreshToken = "opaque-refresh-token_1234567890";
const config = { appOrigin, supabaseUrl: "http://127.0.0.1:56421", publishableKey: "local-publishable-key" };

function request(origin = appOrigin, cookie = `fw_access_token=${accessToken}; fw_refresh_token=${refreshToken}`) {
  return new Request(`${appOrigin}/api/auth/sign-out`, { method: "POST", headers: { origin, cookie } });
}

test("revokes only the current Supabase session and clears both HttpOnly app cookies", async () => {
  let calledUrl: URL | undefined;
  let calledInit: RequestInit | undefined;
  const handler = createSignOutPostHandler(config, async (input, init) => {
    calledUrl = new URL(String(input));
    calledInit = init;
    return new Response(null, { status: 204 });
  });
  const response = await handler(request());
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { signedOut: true, sessionRevocation: "confirmed" });
  assert.equal(calledUrl?.href, "http://127.0.0.1:56421/auth/v1/logout?scope=local");
  assert.equal(calledInit?.method, "POST");
  assert.equal(new Headers(calledInit?.headers).get("authorization"), `Bearer ${accessToken}`);
  assert.equal(new Headers(calledInit?.headers).get("apikey"), config.publishableKey);
  const cookies = response.headers.getSetCookie();
  assert.equal(cookies.length, 2);
  assert.ok(cookies.every((cookie) => /HttpOnly/.test(cookie) && /SameSite=Lax/.test(cookie) && /Max-Age=0/.test(cookie)));
});

test("denies cross-origin sign-out without calling Supabase or clearing cookies", async () => {
  let calls = 0;
  const handler = createSignOutPostHandler(config, async () => { calls += 1; return new Response(null, { status: 204 }); });
  const response = await handler(request("http://localhost:8085"));
  assert.equal(response.status, 403);
  assert.equal(response.headers.getSetCookie().length, 0);
  assert.equal(calls, 0);
});

test("clears local cookies when no valid session exists and reports unknown revocation on provider outage", async () => {
  let calls = 0;
  const handler = createSignOutPostHandler(config, async () => { calls += 1; throw new Error("private transport detail"); });
  const missing = await handler(request(appOrigin, "theme=night"));
  assert.equal(missing.status, 200);
  assert.equal(calls, 0);
  assert.equal(missing.headers.getSetCookie().length, 2);

  const unavailable = await handler(request());
  assert.equal(unavailable.status, 503);
  const body = await unavailable.json();
  assert.deepEqual(body, { signedOut: true, sessionRevocation: "unknown" });
  assert.equal(unavailable.headers.getSetCookie().length, 2);
  assert.doesNotMatch(JSON.stringify(body), /private transport detail/);
});
