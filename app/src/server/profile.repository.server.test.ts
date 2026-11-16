import assert from "node:assert/strict";
import test from "node:test";
import { ProfileRepositoryError } from "./profile.contract.server.ts";
import { createProfileRepository } from "./profile.repository.server.ts";

const config = { url: "http://127.0.0.1:57421", publishableKey: "test-publishable", secretKey: "server-only-secret" };
const id = "11111111-1111-4111-8111-111111111111";

test("an unknown or foreign upload is not_found, not a retryable outage", async () => {
  // The RPC raises this (HTTP 500, P0002) when the file is not this caller's, not quarantined, or already consumed.
  const fetcher = (async () => new Response(JSON.stringify({ code: "P0002", message: "upload_not_quarantined" }), { status: 500, headers: { "content-type": "application/json" } })) as typeof fetch;
  const repository = createProfileRepository(config, { fetcher });
  await assert.rejects(
    repository.beginNormalization({ authUserId: id, fileId: id, expectedProfileRevision: 1, expectedCriticalIdentityVersion: 1 }),
    (error: unknown) => error instanceof ProfileRepositoryError && error.code === "not_found",
  );
});
