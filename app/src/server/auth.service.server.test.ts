import assert from "node:assert/strict";
import test from "node:test";
import { createAuthService } from "./auth.service.server.ts";
import { createAuthHttpHandlers } from "./auth.http.server.ts";

const appOrigin = "http://127.0.0.1:8085";
const authUserId = "946c81d0-f5c8-4c81-a7c0-a3e96b08df2e";
const admissionId = "9f9111d0-266d-4d14-9c56-55a65cd4fd2b";
const tokenHash = "abcdefghijklmnop";
const admission = {
  id: admissionId,
  state: "activated",
  email_normalized: "member@example.test",
} as never;
const session = {
  accessToken: "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJtZW1iZXIifQ.signature_value-123",
  refreshToken: "opaque-refresh-token_1234567890",
};

function deps(overrides: Record<string, unknown> = {}) {
  const calls: string[] = [];
  const value = {
    calls,
    admissionRepository: {
      async findActiveAdmissionByEmail(email: string) { calls.push(`admission:${email}`); return admission; },
      async activateFromVerifiedIdentity(input: { authUserId: string; emailNormalized: string }) {
        calls.push(`activate:${input.authUserId}:${input.emailNormalized}`);
        return { kind: "activated", admission };
      },
    },
    linkRequestRepository: {
      async claimRecipientCooldown(input: { admissionId: string }) { calls.push(`cooldown:${input.admissionId}`); return true; },
    },
    authProvider: {
      async createMagicLink(input: { emailNormalized: string; redirectTo: string; kind: string }) {
        calls.push(`create:${input.kind}:${input.emailNormalized}`);
        return { actionLink: `${appOrigin}/auth/callback?token_hash=${tokenHash}&type=${input.kind}`, authUserId };
      },
      async verifyCallback(input: { tokenHash: string; kind: string }) {
        calls.push(`verify:${input.kind}:${input.tokenHash}`);
        return { identity: { authUserId, emailNormalized: "member@example.test", emailVerified: true }, session };
      },
    },
    async verifyExistingAccessToken(accessToken: string) {
      calls.push(`current:${accessToken}`);
      return null;
    },
    async sendLink(input: { recipientEmail: string; kind: string }) { calls.push(`send:${input.kind}:${input.recipientEmail}`); return { state: "accepted" }; },
    appOrigin,
    now: () => new Date("2026-11-12T17:00:00.000Z"),
    minimumRequestResponseMs: 0,
    ...overrides,
  };
  return value;
}

test("request link is generic, and only active admitted recipients reach cooldown, Auth and mail", async () => {
  const dependency = deps();
  const service = createAuthService(dependency as never);
  assert.deepEqual(await service.requestLink({ email: " MEMBER@example.test " }), { ok: true, value: { accepted: true } });
  assert.deepEqual(dependency.calls, [
    "admission:member@example.test",
    `cooldown:${admissionId}`,
    "create:magiclink:member@example.test",
    "send:magiclink:member@example.test",
  ]);

  const noAdmission = deps();
  (noAdmission.admissionRepository as unknown as { findActiveAdmissionByEmail(email: string): Promise<null> }).findActiveAdmissionByEmail = async (email) => { noAdmission.calls.push(`admission:${email}`); return null; };
  assert.deepEqual(await createAuthService(noAdmission as never).requestLink({ email: "unknown@example.test" }), { ok: true, value: { accepted: true } });
  assert.deepEqual(noAdmission.calls, ["admission:unknown@example.test"]);
});

test("request link stays generic on cooldown and provider failure", async () => {
  const limited = deps({ linkRequestRepository: { async claimRecipientCooldown() { return false; } } });
  assert.deepEqual(await createAuthService(limited as never).requestLink({ email: "member@example.test" }), { ok: true, value: { accepted: true } });
  assert.equal(limited.calls.some((call) => call.startsWith("create:")), false);

  const rejected = deps({ async sendLink() { throw new Error("private provider response"); } });
  assert.deepEqual(await createAuthService(rejected as never).requestLink({ email: "member@example.test" }), { ok: true, value: { accepted: true } });
});

test("request-link outcomes share a minimum response-time floor", async () => {
  const admitted = createAuthService(deps({ minimumRequestResponseMs: 30 }) as never);
  const unknown = deps({ minimumRequestResponseMs: 30 });
  (unknown.admissionRepository as unknown as { findActiveAdmissionByEmail(email: string): Promise<null> }).findActiveAdmissionByEmail = async () => null;
  const notAdmitted = createAuthService(unknown as never);
  const started = performance.now();
  const first = await admitted.requestLink({ email: "member@example.test" });
  const admittedMs = performance.now() - started;
  const secondStart = performance.now();
  const second = await notAdmitted.requestLink({ email: "unknown@example.test" });
  const unknownMs = performance.now() - secondStart;
  assert.deepEqual(first, { ok: true, value: { accepted: true } });
  assert.deepEqual(second, first);
  assert.ok(admittedMs >= 25);
  assert.ok(unknownMs >= 25);
  assert.ok(Math.abs(admittedMs - unknownMs) < 150);
});

test("request-link HTTP response is identical for admitted, cooling-down, unknown and deleted recipients", async () => {
  const actual = deps();
  let sendCount = 0;
  actual.sendLink = async () => { sendCount += 1; return { state: "accepted" }; };
  const coolingDown = deps({ linkRequestRepository: {
    async claimRecipientCooldown() { return false; },
  } });
  const unknown = deps({ admissionRepository: {
    async findActiveAdmissionByEmail() { return null; },
  } });
  const deleted = deps({ admissionRepository: {
    async findActiveAdmissionByEmail() { return { id: admissionId, state: "deleted", email_normalized: "member@example.test" }; },
  } });
  const handlers = [actual, coolingDown, unknown, deleted].map((dependency) =>
    createAuthHttpHandlers(createAuthService(dependency as never), appOrigin).requestLink,
  );

  const responses = await Promise.all(handlers.map((handler) => handler(new Request(`${appOrigin}/api/auth/request-link`, {
    method: "POST",
    headers: { origin: appOrigin, "content-type": "application/json" },
    body: JSON.stringify({ email: "member@example.test" }),
  }))));
  const observations = await Promise.all(responses.map(async (response) => ({
    status: response.status,
    body: await response.json(),
    cacheControl: response.headers.get("cache-control"),
    setCookie: response.headers.get("set-cookie"),
  })));

  assert.deepEqual(observations, Array.from({ length: 4 }, () => ({
    status: 200,
    body: { accepted: true },
    cacheControl: "no-store",
    setCookie: null,
  })));
  assert.equal(sendCount, 1);
  assert.equal(coolingDown.calls.some((call) => call.startsWith("create:")), false);
  assert.equal(unknown.calls.length, 0);
  assert.equal(deleted.calls.length, 0);
});

test("safe Table and invitation continuations survive link generation and verification", async () => {
  const destinations = [
    "/tables/2c8f7a9d-295f-4e5d-9fb0-a9cc5c8a19f0?source=shared",
    "/invitations/4a8f7a9d-295f-4e5d-9fb0-a9cc5c8a19f0",
  ];
  for (const destination of destinations) {
    let requestedReturnTo: string | undefined;
    const dependency = deps({
      authProvider: {
        async createMagicLink(input: { safeReturnTo?: string }) {
          requestedReturnTo = input.safeReturnTo;
          return { actionLink: `${appOrigin}/auth/callback?token_hash=${tokenHash}&type=magiclink`, authUserId };
        },
        async verifyCallback() {
          return { identity: { authUserId, emailNormalized: "member@example.test", emailVerified: true }, session };
        },
      },
    });
    const service = createAuthService(dependency as never);
    assert.deepEqual(await service.requestLink({ email: "member@example.test", safeReturnTo: destination }), {
      ok: true,
      value: { accepted: true },
    });
    assert.equal(requestedReturnTo, destination);
    const verified = await service.verifyLink({ tokenHash, kind: "magiclink", safeReturnTo: destination });
    assert.equal(verified.ok, true);
    if (verified.ok) assert.equal(verified.value.nextPath, destination);
  }
});

test("redirect variants remain on the configured app origin", async () => {
  const candidates = [
    "https://attacker.example/steal",
    "//attacker.example/steal",
    "\\\\attacker.example\\steal",
    "/\\attacker.example/steal",
    "javascript:alert(1)",
    "/%2f%2fattacker.example/steal",
    "/%5c%5cattacker.example/steal",
  ];
  for (const safeReturnTo of candidates) {
    const result = await createAuthService(deps() as never).verifyLink({
      tokenHash,
      kind: "magiclink",
      safeReturnTo,
    });
    assert.equal(result.ok, true);
    if (result.ok) assert.equal(new URL(result.value.nextPath, appOrigin).origin, appOrigin, safeReturnTo);
  }
});

test("verify consumes a verified identity once, activates admission and clamps unsafe return paths", async () => {
  const dependency = deps();
  const result = await createAuthService(dependency as never).verifyLink({
    tokenHash,
    kind: "invite",
    safeReturnTo: "//attacker.example/steal",
  });
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.value.nextPath, "/member");
    assert.equal(result.value.firstActivation, true);
    assert.equal(result.value.session, session);
  }
  assert.deepEqual(dependency.calls, [
    `verify:invite:${tokenHash}`,
    `activate:${authUserId}:member@example.test`,
  ]);
});

test("any active session preserves the one-time link and blocks invite or returning-link redemption", async () => {
  for (const kind of ["invite", "magiclink"] as const) {
    const dependency = deps({
      async verifyExistingAccessToken(accessToken: string) {
        dependency.calls.push(`current:${accessToken}`);
        return { authUserId: "00000000-0000-4000-8000-000000000001", emailNormalized: "admin@example.test", emailVerified: true };
      },
    });
    const result = await createAuthService(dependency as never).verifyLink({
      tokenHash,
      kind,
      existingAccessToken: "existing-admin-session",
    });
    assert.deepEqual(result, {
      ok: false,
      error: {
        code: "conflict",
        safeMessage: "You are already signed in. Sign out first, then reopen this same link. Your current session was kept.",
      },
    });
    assert.deepEqual(dependency.calls, ["current:existing-admin-session"]);
    assert.equal(dependency.calls.some((call) => call.startsWith("activate:")), false);
  }
});

test("current-session verification outage fails closed without consuming the one-time link", async () => {
  const same = deps({
    async verifyExistingAccessToken() {
      return { authUserId, emailNormalized: "member@example.test", emailVerified: true };
    },
  });
  const alreadySignedIn = await createAuthService(same as never).verifyLink({ tokenHash, kind: "magiclink", existingAccessToken: "same-member-session" });
  assert.equal(alreadySignedIn.ok, false);
  assert.equal(same.calls.some((call) => call.startsWith("verify:")), false);

  const unavailable = deps({
    async verifyExistingAccessToken() { throw new Error("private Auth failure"); },
  });
  const failure = await createAuthService(unavailable as never).verifyLink({ tokenHash, kind: "invite", existingAccessToken: "session-cannot-be-checked" });
  assert.equal(failure.ok, false);
  if (!failure.ok) assert.equal(failure.error.code, "temporarily_unavailable");
  assert.equal(unavailable.calls.some((call) => call.startsWith("verify:")), false);
  assert.equal(unavailable.calls.some((call) => call.startsWith("activate:")), false);
});

test("invalid, unverified and unadmitted callback identities never create a member session", async () => {
  const malformed = deps();
  const invalid = await createAuthService(malformed as never).verifyLink({ tokenHash: "short", kind: "invite" });
  assert.equal(invalid.ok, false);
  assert.deepEqual(malformed.calls, []);

  const unverified = deps({ authProvider: {
    async verifyCallback() { return { identity: { authUserId, emailNormalized: "member@example.test", emailVerified: false }, session }; },
  } });
  assert.equal((await createAuthService(unverified as never).verifyLink({ tokenHash, kind: "invite" })).ok, false);
  assert.equal(unverified.calls.some((call) => call.startsWith("activate:")), false);

  const unadmitted = deps({ admissionRepository: {
    async activateFromVerifiedIdentity() { return { kind: "not_admitted" }; },
  } });
  assert.equal((await createAuthService(unadmitted as never).verifyLink({ tokenHash, kind: "invite" })).ok, false);
});

test("HTTP handlers require exact origin and set session cookies without returning tokens", async () => {
  const service = createAuthService(deps() as never);
  const http = createAuthHttpHandlers(service, appOrigin);
  const denied = await http.verifyLink(new Request(`${appOrigin}/api/auth/verify-link`, { method: "POST", body: JSON.stringify({ tokenHash, kind: "invite" }), headers: { "content-type": "application/json" } }));
  assert.equal(denied.status, 403);

  const response = await http.verifyLink(new Request(`${appOrigin}/api/auth/verify-link`, {
    method: "POST",
    headers: { origin: appOrigin, "content-type": "application/json" },
    body: JSON.stringify({ tokenHash, kind: "invite", safeReturnTo: "/tables/1" }),
  }));
  assert.equal(response.status, 200);
  const responseBody = await response.text();
  assert.deepEqual(JSON.parse(responseBody), { nextPath: "/tables/1" });
  assert.match(response.headers.get("set-cookie") ?? "", /fw_access_token=.*HttpOnly; SameSite=Lax/);
  assert.doesNotMatch(responseBody, /accessToken|refreshToken|opaque-refresh/);

  const requestLink = await http.requestLink(new Request(`${appOrigin}/api/auth/request-link`, {
    method: "POST",
    headers: { origin: appOrigin, "content-type": "application/json" },
    body: JSON.stringify({ email: "unknown@example.test" }),
  }));
  assert.equal(requestLink.status, 200);
  assert.deepEqual(await requestLink.json(), { accepted: true });
});

test("HTTP callback with any existing verified session returns conflict without replacing cookies", async () => {
  const dependency = deps({
    async verifyExistingAccessToken(accessToken: string) {
      dependency.calls.push(`current:${accessToken}`);
      return { authUserId: "00000000-0000-4000-8000-000000000001", emailNormalized: "admin@example.test", emailVerified: true };
    },
  });
  const http = createAuthHttpHandlers(createAuthService(dependency as never), appOrigin);
  const response = await http.verifyLink(new Request(`${appOrigin}/api/auth/verify-link`, {
    method: "POST",
    headers: {
      origin: appOrigin,
      cookie: `fw_access_token=${session.accessToken}; fw_refresh_token=${session.refreshToken}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({ tokenHash, kind: "invite" }),
  }));

  assert.equal(response.status, 409);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.equal(response.headers.get("set-cookie"), null);
  assert.deepEqual(await response.json(), {
    error: {
      code: "conflict",
      message: "You are already signed in. Sign out first, then reopen this same link. Your current session was kept.",
    },
  });
  assert.deepEqual(dependency.calls, [`current:${session.accessToken}`]);
});
