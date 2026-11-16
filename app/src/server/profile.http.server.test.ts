import assert from "node:assert/strict";
import test from "node:test";
import type { ProfileServicePort } from "./profile.contract.server.ts";
import { createProfileHttpHandlers } from "./profile.http.server.ts";

function fakeService(calls: unknown[]) {
  return {
    readMemberProfile: async (token: string | null) => {
      calls.push(["get", token]);
      return { ok: false as const, code: "unauthenticated" as const, message: "Sign in.", retryable: false, correlationId: "c-1" };
    },
    saveMemberProfile: async (...args: unknown[]) => { calls.push(["save", ...args]); return { ok: false as const, code: "invalid_input" as const, message: "Invalid.", retryable: false, correlationId: "c-2" }; },
  } as unknown as ProfileServicePort;
}

function handlers(calls: unknown[]) {
  const service = fakeService(calls);
  return createProfileHttpHandlers({ service: () => service, appOrigin: "http://127.0.0.1:8086" });
}

test("W04 HTTP: profile reads use only the verified session cookie and are no-store", async () => {
  const calls: unknown[] = [];
  const response = await handlers(calls).memberGet(new Request("http://127.0.0.1:8086/api/member/profile", {
    headers: { cookie: "fw_access_token=aaa.bbb.ccc" },
  }));
  assert.equal(response.status, 401);
  assert.equal(response.headers.get("cache-control"), "private, no-store");
  assert.equal(response.headers.get("vary"), "Cookie");
  assert.deepEqual(calls, [["get", "aaa.bbb.ccc"]]);
});

test("W04 HTTP: cookie-authenticated saves fail closed on missing or mismatched Origin", async () => {
  const calls: unknown[] = [];
  const route = handlers(calls);
  const missing = await route.memberSave(new Request("http://127.0.0.1:8086/api/member/profile", {
    method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ operationId: "x" }),
  }));
  const wrong = await route.memberSave(new Request("http://127.0.0.1:8086/api/member/profile", {
    method: "PUT", headers: { origin: "https://attacker.example", "content-type": "application/json" }, body: "{}",
  }));
  assert.equal(missing.status, 403);
  assert.equal(wrong.status, 403);
  assert.equal(calls.length, 0);
});

test("W04 HTTP: missing server configuration returns a safe structured 503", async () => {
  const route = createProfileHttpHandlers({
    service: () => { throw new Error("configuration details must not escape"); },
    appOrigin: "http://127.0.0.1:8086",
  });
  const response = await route.memberGet(new Request("http://127.0.0.1:8086/api/member/profile"));
  assert.equal(response.status, 503);
  assert.equal(response.headers.get("cache-control"), "private, no-store");
  const body = await response.json() as Record<string, unknown>;
  assert.equal(body.code, "temporarily_unavailable");
  assert.equal(JSON.stringify(body).includes("configuration details"), false);
});
