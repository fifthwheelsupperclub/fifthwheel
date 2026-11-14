import assert from "node:assert/strict";
import test from "node:test";
import type { ServiceResult } from "./admission.contracts.server.ts";
import type { AdminWaitlistSearchInput, AdminWaitlistSearchResult } from "./admission.service.server.ts";
import { createAdmissionService } from "./admission.service.server.ts";
import { createAdminWaitlistGetHandler, createAdminWaitlistInvitePostHandler } from "./admin.waitlist.http.server.ts";

const accessToken = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJhZG1pbiJ9.signature_value-123";
const refreshToken = "opaque-refresh-token_1234567890";
const cookieHeader = `fw_access_token=${accessToken}; fw_refresh_token=${refreshToken}`;

function request(url: string, cookie: string | null = cookieHeader, authorization?: string): Request {
  const headers = new Headers();
  if (cookie !== null) headers.set("cookie", cookie);
  if (authorization) headers.set("authorization", authorization);
  return new Request(url, { headers });
}

test("uses only the session cookie, parses bounded filters, and returns a no-store minimal result", async () => {
  let createCount = 0;
  let received: AdminWaitlistSearchInput | undefined;
  const result: ServiceResult<AdminWaitlistSearchResult> = {
    ok: true,
    value: {
      items: [{
        id: "2c8f7a9d-295f-4e5d-9fb0-a9cc5c8a19f0",
        firstName: "Casey",
        lastName: "Example",
        emailNormalized: "casey@example.test",
        neighborhood: "Inman Park",
        identity: "Woman",
        openTo: ["Women", "Men"],
        receivedAt: "2026-11-12T12:00:00Z",
        admissionState: "none",
        latestDelivery: null,
      }],
      nextCursor: null,
    },
  };
  const handler = createAdminWaitlistGetHandler(() => {
    createCount += 1;
    return {
      async searchWaitlist(input) {
        received = input;
        return result;
      },
    };
  });

  const response = await handler(request(
    "http://127.0.0.1:8085/api/admin/waitlist?query=Casey%20Example&neighborhood=Inman%20Park&cursor=YWJj&limit=10",
    cookieHeader,
    "Bearer must-not-be-used",
  ));
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.equal(response.headers.get("vary"), "Cookie");
  assert.equal(response.headers.get("content-type"), "application/json");
  assert.equal(createCount, 1);
  assert.deepEqual(received, {
    accessToken,
    query: "Casey Example",
    neighborhood: "Inman Park",
    cursor: "YWJj",
    limit: 10,
  });
  assert.deepEqual(await response.json(), result.value);
});

test("rejects missing, duplicate and malformed cookies before creating a service", async () => {
  let createCount = 0;
  const handler = createAdminWaitlistGetHandler(() => {
    createCount += 1;
    throw new Error("should not be reached");
  });

  for (const req of [
    request("http://127.0.0.1:8085/api/admin/waitlist", null, `Bearer ${accessToken}`),
    request("http://127.0.0.1:8085/api/admin/waitlist", `fw_access_token=${accessToken}; fw_access_token=${accessToken}`),
    request("http://127.0.0.1:8085/api/admin/waitlist", "fw_access_token=not-a-jwt"),
  ]) {
    const response = await handler(req);
    assert.equal(response.status, 401);
    assert.equal(response.headers.get("cache-control"), "no-store");
    assert.deepEqual(await response.json(), { error: { code: "unauthenticated", message: "Sign in to continue." } });
  }
  assert.equal(createCount, 0);
});

test("rejects unsupported, duplicate and out-of-range query parameters before service access", async () => {
  let createCount = 0;
  const handler = createAdminWaitlistGetHandler(() => {
    createCount += 1;
    throw new Error("should not be reached");
  });
  const badQueries = [
    "?other=value",
    "?query=one&query=two",
    "?neighborhood=Atlanta",
    "?cursor=bad%20cursor",
    "?limit=0",
    "?limit=101",
    `?query=${"x".repeat(121)}`,
  ];
  for (const query of badQueries) {
    const response = await handler(request(`http://127.0.0.1:8085/api/admin/waitlist${query}`));
    assert.equal(response.status, 400, query);
    assert.deepEqual(await response.json(), {
      error: { code: "validation_failed", message: "Check the waitlist filters and try again." },
    });
  }
  assert.equal(createCount, 0);
});

test("maps safe service failures to HTTP status and never leaks private error fields", async () => {
  const handler = createAdminWaitlistGetHandler(() => ({
    async searchWaitlist() {
      return {
        ok: false,
        error: {
          code: "forbidden",
          safeMessage: "You are not allowed to view the waitlist.",
          fields: { secret: "must not be returned" },
        },
      };
    },
  }));
  const response = await handler(request("http://127.0.0.1:8085/api/admin/waitlist"));
  assert.equal(response.status, 403);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.deepEqual(await response.json(), {
    error: { code: "forbidden", message: "You are not allowed to view the waitlist." },
  });
});

test("turns configuration and unexpected service errors into a safe unavailable response", async () => {
  const handler = createAdminWaitlistGetHandler(() => { throw new Error("private config/secret detail"); });
  const response = await handler(request("http://127.0.0.1:8085/api/admin/waitlist"));
  assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), {
    error: { code: "temporarily_unavailable", message: "Waitlist search is temporarily unavailable." },
  });
});

test("queues an admin invitation only with the session cookie and exact configured Origin", async () => {
  const signupId = "2c8f7a9d-295f-4e5d-9fb0-a9cc5c8a19f0";
  const operationId = "a80394c5-23d2-4c3f-b84d-eec48222ad62";
  let received: unknown;
  const handler = createAdminWaitlistInvitePostHandler(() => ({
    async admitWaitlistMember(input) {
      received = input;
      return {
        ok: true,
        value: {
          signupId,
          admissionId: "5f4836d7-4f52-44cb-83a3-f035b792a0ab",
          admissionState: "invited",
          deliveryId: "7f7c9d27-22c6-4d6f-9307-f9d4ba7f59b1",
          operationId,
          deliveryState: "queued",
          created: true,
        },
      };
    },
  }), "http://127.0.0.1:8085");
  const response = await handler(new Request("http://127.0.0.1:8085/api/admin/waitlist/invitations", {
    method: "POST",
    headers: {
      origin: "http://127.0.0.1:8085",
      cookie: cookieHeader,
      "content-type": "application/json",
    },
    body: JSON.stringify({ signupId, operationId }),
  }));
  assert.equal(response.status, 202);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.equal(response.headers.get("vary"), "Cookie, Origin");
  assert.deepEqual(received, { accessToken, signupId, operationId });
  const result = await response.json();
  assert.equal(result.value.deliveryState, "queued");
  assert.equal("emailSent" in result.value, false);
});

test("rejects missing/mismatched Origin and bearer-only admission calls before service access", async () => {
  let calls = 0;
  const handler = createAdminWaitlistInvitePostHandler(() => {
    calls += 1;
    throw new Error("should not be reached");
  }, "http://127.0.0.1:8085");
  const payload = JSON.stringify({
    signupId: "2c8f7a9d-295f-4e5d-9fb0-a9cc5c8a19f0",
    operationId: "a80394c5-23d2-4c3f-b84d-eec48222ad62",
  });

  const requestHeaders = [
    new Headers({ cookie: cookieHeader, "content-type": "application/json" }),
    new Headers({ origin: "http://localhost:8085", cookie: cookieHeader, "content-type": "application/json" }),
    new Headers({ origin: "http://127.0.0.1:8085", authorization: `Bearer ${accessToken}`, "content-type": "application/json" }),
  ];
  for (const headers of requestHeaders) {
    const response = await handler(new Request("http://127.0.0.1:8085/api/admin/waitlist/invitations", {
      method: "POST", headers, body: payload,
    }));
    assert.ok(response.status === 401 || response.status === 403);
    assert.equal(response.headers.get("cache-control"), "no-store");
  }
  assert.equal(calls, 0);
});

test("replaying the same admin admission operation through HTTP reuses one logical queue record", async () => {
  const signupId = "2c8f7a9d-295f-4e5d-9fb0-a9cc5c8a19f0";
  const operationId = "a80394c5-23d2-4c3f-b84d-eec48222ad62";
  const admissionId = "5f4836d7-4f52-44cb-83a3-f035b792a0ab";
  const deliveryId = "7f7c9d27-22c6-4d6f-9307-f9d4ba7f59b1";
  const operations = new Map<string, { admissionId: string; deliveryId: string }>();
  let rpcCalls = 0;
  const service = createAdmissionService({
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
    waitlistRepository: { async search() { return { rows: [], nextCursor: null }; } },
    admissionRepository: {
      async admitAndQueueInvitation(input) {
        rpcCalls += 1;
        assert.equal(input.signupId, signupId);
        assert.equal(input.operationId, operationId);
        const previous = operations.get(input.operationId);
        if (!previous) operations.set(input.operationId, { admissionId, deliveryId });
        return {
          admission: {
            id: admissionId,
            waitlist_signup_id: signupId,
            email_normalized: "member@example.test",
            state: "invited",
            approved_by: input.approvedByUserId,
            approved_at: "2026-11-12T12:00:00.000Z",
            auth_user_id: null,
            activated_at: null,
            deleted_at: null,
            created_at: "2026-11-12T12:00:00.000Z",
            updated_at: "2026-11-12T12:00:00.000Z",
          },
          delivery: {
            id: deliveryId,
            admission_id: admissionId,
            operation_id: operationId,
            state: "queued",
            provider_message_id: null,
            attempt_count: 0,
            error_code: null,
            queued_at: "2026-11-12T12:00:00.000Z",
            next_attempt_at: "2026-11-12T12:00:00.000Z",
            lease_until: null,
            attempted_at: null,
            accepted_at: null,
            delivered_at: null,
            created_by: input.approvedByUserId,
            created_at: "2026-11-12T12:00:00.000Z",
          },
          created: previous === undefined,
        } as never;
      },
    },
  });
  const handler = createAdminWaitlistInvitePostHandler(() => service, "http://127.0.0.1:8085");
  const send = () => handler(new Request("http://127.0.0.1:8085/api/admin/waitlist/invitations", {
    method: "POST",
    headers: { origin: "http://127.0.0.1:8085", cookie: cookieHeader, "content-type": "application/json" },
    body: JSON.stringify({ signupId, operationId }),
  }));

  const first = await send();
  const replay = await send();
  assert.equal(first.status, 202);
  assert.equal(replay.status, 202);
  const firstBody = await first.json();
  const replayBody = await replay.json();
  assert.equal(firstBody.value.admissionId, admissionId);
  assert.equal(replayBody.value.admissionId, admissionId);
  assert.equal(firstBody.value.deliveryId, deliveryId);
  assert.equal(replayBody.value.deliveryId, deliveryId);
  assert.equal(firstBody.value.operationId, operationId);
  assert.equal(replayBody.value.operationId, operationId);
  assert.equal(firstBody.value.created, true);
  assert.equal(replayBody.value.created, false);
  assert.equal(operations.size, 1);
  assert.equal(rpcCalls, 2);
});
