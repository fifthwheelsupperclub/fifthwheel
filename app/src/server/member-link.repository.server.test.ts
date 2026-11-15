import assert from "node:assert/strict";
import test from "node:test";
import { createMemberLinkRepository, MemberLinkRepositoryError } from "./member-link.repository.server.ts";

const config = { url: "http://127.0.0.1:56421", publishableKey: "public-key", secretKey: "server-secret" };
const admissionId = "9f9111d0-266d-4d14-9c56-55a65cd4fd2b";

test("claims a cooldown through the server-only RPC contract", async () => {
  let captured: { url?: URL; init?: RequestInit } = {};
  const repository = createMemberLinkRepository(config, async (input, init) => {
    captured = { url: new URL(String(input)), init };
    return new Response("true", { status: 200, headers: { "content-type": "application/json" } });
  });
  assert.equal(await repository.claimRecipientCooldown({ admissionId, requestedAt: "2026-11-12T17:00:00.000Z", cooldownSeconds: 300 }), true);
  assert.equal(captured.url?.pathname, "/rest/v1/rpc/claim_member_link_cooldown");
  const headers = new Headers(captured.init?.headers);
  assert.equal(headers.get("apikey"), config.secretKey);
  assert.equal(headers.get("authorization"), `Bearer ${config.secretKey}`);
  assert.deepEqual(JSON.parse(String(captured.init?.body)), { p_admission_id: admissionId, p_requested_at: "2026-11-12T17:00:00.000Z", p_cooldown_seconds: 300 });
});

test("rejects malformed input and nonboolean provider responses", async () => {
  let calls = 0;
  const repository = createMemberLinkRepository(config, async () => { calls += 1; return new Response("true", { status: 200 }); });
  await assert.rejects(() => repository.claimRecipientCooldown({ admissionId: "bad", requestedAt: "2026-11-12T17:00:00Z", cooldownSeconds: 300 }), MemberLinkRepositoryError);
  assert.equal(calls, 0);
  const badBody = createMemberLinkRepository(config, async () => new Response("{bad", { status: 200 }));
  await assert.rejects(() => badBody.claimRecipientCooldown({ admissionId, requestedAt: "2026-11-12T17:00:00Z", cooldownSeconds: 300 }), MemberLinkRepositoryError);
});
