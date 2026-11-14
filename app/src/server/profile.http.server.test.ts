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
    createMemberUploadIntent: async (...args: unknown[]) => { calls.push(["intent", ...args]); return { ok: false as const, code: "invalid_input" as const, message: "Invalid.", retryable: false, correlationId: "c-3" }; },
    receiveMemberUpload: async (...args: unknown[]) => { calls.push(["upload", ...args]); return { ok: true as const, data: { fileId: "f", received: true as const, byteSize: 3 }, correlationId: "c-4" }; },
    completeMemberUpload: async (...args: unknown[]) => { calls.push(["complete", ...args]); return { ok: false as const, code: "invalid_input" as const, message: "Invalid.", retryable: false, correlationId: "c-5" }; },
    getOwnerFileReadUrl: async (...args: unknown[]) => { calls.push(["read-url", ...args]); return { ok: false as const, code: "invalid_input" as const, message: "Invalid.", retryable: false, correlationId: "c-6" }; },
    submitMemberProfile: async (...args: unknown[]) => { calls.push(["submit", ...args]); return { ok: false as const, code: "invalid_input" as const, message: "Invalid.", retryable: false, correlationId: "c-7" }; },
    deleteMemberProfileFile: async (...args: unknown[]) => { calls.push(["delete", ...args]); return { ok: false as const, code: "invalid_input" as const, message: "Invalid.", retryable: false, correlationId: "c-8" }; },
    listAdminIdentityReviews: async (...args: unknown[]) => { calls.push(["list", ...args]); return { ok: true as const, data: { items: [], nextCursor: null }, correlationId: "c-9" }; },
    readAdminIdentityReview: async (...args: unknown[]) => { calls.push(["detail", ...args]); return { ok: false as const, code: "not_found" as const, message: "Missing.", retryable: false, correlationId: "c-10" }; },
    decideAdminIdentityReview: async (...args: unknown[]) => { calls.push(["decision", ...args]); return { ok: false as const, code: "invalid_input" as const, message: "Invalid.", retryable: false, correlationId: "c-11" }; },
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

test("W04 HTTP: cookie-authenticated mutations fail closed on missing or mismatched Origin", async () => {
  const calls: unknown[] = [];
  const route = handlers(calls);
  const missing = await route.memberSubmit(new Request("http://127.0.0.1:8086/api/member/profile/submit", {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ operationId: "x" }),
  }));
  const wrong = await route.uploadIntent(new Request("http://127.0.0.1:8086/api/member/profile/files", {
    method: "POST", headers: { origin: "https://attacker.example", "content-type": "application/json" }, body: "{}",
  }));
  assert.equal(missing.status, 403);
  assert.equal(wrong.status, 403);
  assert.equal(calls.length, 0);
});

test("W04 HTTP: raw upload body is handed through with its one-time header and private response headers", async () => {
  const calls: unknown[] = [];
  const body = new Uint8Array([1, 2, 3]);
  const response = await handlers(calls).uploadContent(new Request("http://127.0.0.1:8086/api/member/profile/files/f/content", {
    method: "PUT",
    headers: {
      origin: "http://127.0.0.1:8086",
      cookie: "fw_access_token=aaa.bbb.ccc",
      "content-type": "image/jpeg",
      "x-fw-upload-token": "one-time-token",
    },
    body,
  }), { fileId: "30000000-0000-4000-8000-000000000001" });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "private, no-store");
  const call = calls[0] as [string, string, string, string, Request];
  assert.equal(call[0], "upload");
  assert.equal(call[1], "aaa.bbb.ccc");
  assert.equal(call[2], "30000000-0000-4000-8000-000000000001");
  assert.equal(call[3], "one-time-token");
  assert.equal(new Uint8Array(await call[4].arrayBuffer()).byteLength, 3);
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
