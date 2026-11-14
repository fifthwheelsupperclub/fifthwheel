import assert from "node:assert/strict";
import { test } from "node:test";
import type { RosterContextInput, RosterListInput, RosterProposalActionInput, RosterService, SaveRosterInput } from "./roster.contract.server.ts";
import { createRosterHttpHandlers } from "./roster.http.server.ts";

const tableId = "11111111-1111-4111-8111-111111111111";
const revisionId = "22222222-2222-4222-8222-222222222222";
const requestId = "33333333-3333-4333-8333-333333333333";
const operationId = "44444444-4444-4444-8444-444444444444";
const token = "eyJhbGciOiJub25lIn0.eyJzdWIiOiJ0ZXN0In0.signature";
const inputs: Array<{ method: string; value: unknown }> = [];
function fakeService(): RosterService {
  return {
    async listAdminSeatRequests(input: RosterListInput) { inputs.push({ method: "admin-list", value: input }); return { ok: true, value: { items: [], nextCursor: null } }; },
    async listAssignedCurationTables(input: RosterListInput) { inputs.push({ method: "assigned-list", value: input }); return { ok: true, value: { items: [], nextCursor: null } }; },
    async readTableRoster(input: RosterContextInput) { inputs.push({ method: "read", value: input }); return { ok: true, value: { table: { tableId, title: "June Table", localDate: "2027-06-12", startLocalTime: "18:30", neighborhood: "Inman Park", publishedRevisionId: revisionId, readOnlyReason: null }, applicants: { items: [], nextCursor: null }, currentProposal: null, permissions: { canEditProposal: true, canSubmit: false, canApprove: false } } }; },
    async saveRosterProposal(input: SaveRosterInput) { inputs.push({ method: "save", value: input }); return { ok: true, value: { proposalId: "55555555-5555-4555-8555-555555555555", revision: 1, state: "draft", supplyRevisionId: revisionId, selectedRequestIds: [requestId], selectedGuests: [{ guestId: "99999999-9999-4999-8999-999999999999", displayName: "Alex Guest" }], validation: { valid: false, issues: [{ code: "select_three_to_five" }] }, createdAt: "2026-11-13T12:00:00Z", updatedAt: "2026-11-13T12:00:00Z" } }; },
    async submitRosterProposal(input: RosterProposalActionInput) { inputs.push({ method: "submit", value: input }); return { ok: true, value: { proposalId: "55555555-5555-4555-8555-555555555555", revision: 1, state: "submitted", supplyRevisionId: revisionId, selectedRequestIds: [requestId], selectedGuests: [{ guestId: "99999999-9999-4999-8999-999999999999", displayName: "Alex Guest" }], validation: { valid: true, issues: [] }, createdAt: "2026-11-13T12:00:00Z", updatedAt: "2026-11-13T12:00:00Z" } }; },
    async approveRoster(input: RosterProposalActionInput) { inputs.push({ method: "approve", value: input }); return { ok: true, value: { proposal: { proposalId: "55555555-5555-4555-8555-555555555555", revision: 1, state: "approved" }, invitations: [1, 2, 3].map((n) => ({ invitationId: `${n}5555555-5555-4555-8555-555555555555`, guestId: `${n}6666666-6666-4666-8666-666666666666`, state: "active", deliveryState: "queued" })) } }; },
  } as unknown as RosterService;
}
function body(response: Response) { return response.json() as Promise<Record<string, any>>; }

test("GET curation endpoints reject unknown or duplicate query parameters", async () => {
  inputs.length = 0;
  const handlers = createRosterHttpHandlers(fakeService, "http://127.0.0.1:8085");
  const response = await handlers.listAssignedCurationTables(new Request("http://127.0.0.1:8085/api/curation/assigned-tables?limit=10&limit=20"));
  assert.equal(response.status, 400);
  assert.equal(inputs.length, 0);
});

test("proposal mutation requires exact origin and rejects caller-selected actor fields", async () => {
  inputs.length = 0;
  const handlers = createRosterHttpHandlers(fakeService, "http://127.0.0.1:8085");
  const originDenied = await handlers.submitRosterProposal(new Request(`http://127.0.0.1:8085/api/curation/tables/${tableId}/roster-proposal/submit`, {
    method: "POST", headers: { origin: "http://localhost:8085", "content-type": "application/json", cookie: `fw_access_token=${token}` },
    body: JSON.stringify({ operationId, expectedProposalRevision: 1 }),
  }), tableId);
  assert.equal(originDenied.status, 403);
  const extraField = await handlers.saveRosterProposal(new Request(`http://127.0.0.1:8085/api/curation/tables/${tableId}/roster-proposal`, {
    method: "PUT", headers: { origin: "http://127.0.0.1:8085", "content-type": "application/json", cookie: `fw_access_token=${token}` },
    body: JSON.stringify({ operationId, expectedProposalRevision: null, supplyRevisionId: revisionId, selectedRequestIds: [requestId], actorUserId: "spoofed" }),
  }), tableId);
  assert.equal(extraField.status, 400);
  assert.equal(inputs.length, 0);
});

test("valid request shape sends only operation and selection data with cookie-derived token", async () => {
  inputs.length = 0;
  const handlers = createRosterHttpHandlers(fakeService, "http://127.0.0.1:8085");
  const response = await handlers.saveRosterProposal(new Request(`http://127.0.0.1:8085/api/curation/tables/${tableId}/roster-proposal`, {
    method: "PUT", headers: { origin: "http://127.0.0.1:8085", "content-type": "application/json", cookie: `fw_access_token=${token}` },
    body: JSON.stringify({ operationId, expectedProposalRevision: null, supplyRevisionId: revisionId, selectedRequestIds: [requestId] }),
  }), tableId);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "private, no-store");
  assert.deepEqual(inputs[0], { method: "save", value: { accessToken: token, tableId,
    request: { operationId, expectedProposalRevision: null, supplyRevisionId: revisionId, selectedRequestIds: [requestId] } } });
  assert.equal((await body(response)).ok, true);
});
