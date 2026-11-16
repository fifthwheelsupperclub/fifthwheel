import assert from "node:assert/strict";
import test from "node:test";
import { ProfileRepositoryError } from "./profile.contract.server.ts";
import { createProfileRepository } from "./profile.repository.server.ts";

const config = { url: "http://127.0.0.1:57421", publishableKey: "test-publishable", secretKey: "server-only-secret" };
const id = "11111111-1111-4111-8111-111111111111";

test("a stale profile save is a conflict, not invalid input", async () => {
  // save_member_profile raises P0001 profile_revision_conflict, which PostgREST returns as HTTP 400.
  const fetcher = (async () => new Response(JSON.stringify({ code: "P0001", message: "profile_revision_conflict" }), { status: 400, headers: { "content-type": "application/json" } })) as typeof fetch;
  const repository = createProfileRepository(config, { fetcher });
  await assert.rejects(
    repository.saveProfile({ authUserId: id, operationId: id, expectedProfileRevision: 1, fields: {} }),
    (error: unknown) => error instanceof ProfileRepositoryError && error.code === "conflict",
  );
});
