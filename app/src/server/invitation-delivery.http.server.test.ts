import assert from "node:assert/strict";
import test from "node:test";
import { createAdminInvitationSendHandler } from "./invitation-delivery.http.server.ts";
import { createInvitationDeliveryService } from "./invitation-delivery.service.server.ts";

const appOrigin = "http://127.0.0.1:8085";
const deliveryId = "946c81d0-f5c8-4c81-a7c0-a3e96b08df65";
const operationId = "946c81d0-f5c8-4c81-a7c0-a3e96b08df6a";
const attemptId = "946c81d0-f5c8-4c81-a7c0-a3e96b08df69";
const accessToken = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJhZG1pbiJ9.signature_value-123";
const cookies = `fw_access_token=${accessToken}; fw_refresh_token=opaque-refresh-token_1234567890`;

test("same admin attempt operation replay reaches the route twice but cannot send a duplicate email", async () => {
  const claims = new Map<string, { attemptId: string; state: string }>();
  let claimCalls = 0;
  let sendCalls = 0;
  let finishCalls = 0;
  const service = createInvitationDeliveryService({
    async resolvePrincipal() {
      return {
        userId: "946c81d0-f5c8-4c81-a7c0-a3e96b08df2e",
        emailNormalized: "admin@example.test",
        emailVerified: true,
        staffRoles: new Set(["admin"]),
        admission: { state: "none", authUserId: null, emailNormalized: null },
        assignedTableIds: new Set(),
        assignedVenueIds: new Set(),
      };
    },
    async getContext(id) {
      assert.equal(id, deliveryId);
      return { deliveryId, admissionId: "946c81d0-f5c8-4c81-a7c0-a3e96b08df63", signupId: "946c81d0-f5c8-4c81-a7c0-a3e96b08df61", recipientEmail: "member@example.test", admissionState: "invited" };
    },
    async beginAttempt(input) {
      claimCalls += 1;
      assert.equal(input.operationId, operationId);
      const previous = claims.get(input.operationId);
      if (previous) return { delivery: { id: deliveryId, state: "accepted" }, attempt: { id: previous.attemptId }, created: false };
      claims.set(input.operationId, { attemptId, state: "sending" });
      return { delivery: { id: deliveryId, state: "sending" }, attempt: { id: attemptId }, created: true };
    },
    async finishAttempt(input) {
      finishCalls += 1;
      assert.equal(input.attemptId, attemptId);
      assert.equal(input.state, "accepted");
      claims.set(operationId, { attemptId, state: input.state });
    },
    async getLatestAttempt() { return null; },
    async reconcileAttempt() {},
    authProvider: {
      async createMagicLink() {
        return { actionLink: `${appOrigin}/auth/callback?token_hash=abcdefghijklmnop&type=invite`, authUserId: "946c81d0-f5c8-4c81-a7c0-a3e96b08df2e" };
      },
      async verifyCallback() { throw new Error("unused in send-attempt test"); },
    },
    emailProvider: {
      async sendAppInvitation() {
        sendCalls += 1;
        return { state: "accepted", providerMessageId: "mailpit-message-1" };
      },
      async reconcile() { return { state: "unknown" }; },
    },
    appOrigin,
    now: () => new Date("2026-11-12T17:00:00.000Z"),
  });
  const handler = createAdminInvitationSendHandler(service, appOrigin);
  const send = () => handler(new Request(`${appOrigin}/api/admin/invitation-deliveries/${deliveryId}/attempts`, {
    method: "POST",
    headers: { origin: appOrigin, cookie: cookies, "content-type": "application/json" },
    body: JSON.stringify({ operationId }),
  }), deliveryId);

  const first = await send();
  const replay = await send();
  assert.equal(first.status, 200);
  assert.equal(first.headers.get("cache-control"), "no-store");
  assert.equal(replay.status, 409);
  assert.equal(replay.headers.get("cache-control"), "no-store");
  assert.equal(claimCalls, 2);
  assert.equal(sendCalls, 1);
  assert.equal(finishCalls, 1);
  assert.deepEqual(await replay.json(), {
    error: { code: "conflict", safeMessage: "This send operation was already claimed. Review its delivery status before taking another action." },
  });
});

test("send attempt route denies missing Origin before authorization or provider calls", async () => {
  let serviceCalls = 0;
  const service = {
    async send() { serviceCalls += 1; return { ok: true, value: { deliveryId, attemptId, state: "accepted", safeMessage: "accepted" } }; },
    async reconcile() { throw new Error("unused"); },
  } as never;
  const handler = createAdminInvitationSendHandler(service, appOrigin);
  const response = await handler(new Request(`${appOrigin}/api/admin/invitation-deliveries/${deliveryId}/attempts`, {
    method: "POST",
    headers: { cookie: cookies, "content-type": "application/json" },
    body: JSON.stringify({ operationId }),
  }), deliveryId);
  assert.equal(response.status, 403);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.equal(serviceCalls, 0);
});
