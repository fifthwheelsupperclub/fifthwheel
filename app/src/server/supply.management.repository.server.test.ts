import assert from "node:assert/strict";
import test from "node:test";
import { createSupplyManagementRepository, SupplyManagementRepositoryError } from "./supply.management.repository.server.ts";

const venueId = "d7a6c8e2-51e8-4a2b-9672-052160a54101";
const stop = { venueId, venueName: "Venue", venueAddress: "1 Test Way", publicNotes: "" };
const request = {
  operationId: "d7a6c8e2-51e8-4a2b-9672-052160a54201",
  source: { kind: "manual" as const, content: {
    title: "Table", localDate: "2026-12-03", startLocalTime: "19:00", neighborhood: "Inman Park", hostNotes: "",
    stops: [{ ...stop, role: "drinks" as const, minutesFromStart: 0 }, { ...stop, role: "dinner" as const, minutesFromStart: 45 }, { ...stop, role: "dessert" as const, minutesFromStart: 120 }] as const,
  } },
};

function configuredRepository(body: unknown) {
  const calls: RequestInit[] = [];
  const repository = createSupplyManagementRepository({
    url: "http://127.0.0.1:57421", publishableKey: "publishable-test-only", secretKey: "server-secret-test-only",
    async fetch(_input, init) {
      calls.push(init ?? {});
      return Response.json(body, { status: 404 });
    },
  });
  return { repository, calls };
}

test("draft RPC forwards only the server credential and maps PostgREST function errors safely", async () => {
  const { repository, calls } = configuredRepository({ code: "42883", message: "operator does not exist: record ->> unknown" });
  await assert.rejects(repository.createDraft("d7a6c8e2-51e8-4a2b-9672-052160a54001", request), (error: unknown) => {
    assert.ok(error instanceof SupplyManagementRepositoryError);
    assert.equal(error.code, "response_invalid");
    return true;
  });
  assert.equal(calls.length, 1);
  const headers = new Headers(calls[0]?.headers);
  assert.equal(headers.get("authorization"), "Bearer server-secret-test-only");
  assert.equal(headers.get("apikey"), "server-secret-test-only");
  assert.equal(JSON.parse(String(calls[0]?.body)).p_request.source.kind, "manual");
});

test("only explicit RPC not_found maps a 404 to a domain not-found error", async () => {
  const { repository } = configuredRepository({ code: "P0002", message: "not_found" });
  await assert.rejects(repository.createDraft("d7a6c8e2-51e8-4a2b-9672-052160a54001", request), (error: unknown) => {
    assert.ok(error instanceof SupplyManagementRepositoryError);
    assert.equal(error.code, "not_found");
    return true;
  });
});
