import assert from "node:assert/strict";
import test from "node:test";
import type {
  SupplyCreateDraftResultDTO, SupplyDraftContent, SupplyRevisionSummaryDTO, SupplyTableDetailDTO,
} from "../supply.management.contract.ts";
import type { ServerVerifiedPrincipal } from "./authorization.server.ts";
import { createSupplyManagementService } from "./supply.management.service.server.ts";
import type { SupplyManagementRepository } from "./supply.management.contract.server.ts";

const adminId = "946c81d0-f5c8-4c81-a7c0-a3e96b08df2e";
const hostId = "946c81d0-f5c8-4c81-a7c0-a3e96b08df30";
const tableId = "2c8f7a9d-295f-4e5d-9fb0-a9cc5c8a19f0";
const revisionId = "a80394c5-23d2-4c3f-b84d-eec48222ad62";
const operationId = "b80394c5-23d2-4c3f-b84d-eec48222ad62";
const venueId = "5f4836d7-4f52-44cb-83a3-f035b792a0ab";

const content: SupplyDraftContent = {
  title: "Synthetic Thursday Table", localDate: "2026-11-19", startLocalTime: "19:00",
  neighborhood: "Inman Park", hostNotes: "Call the host stand on arrival.",
  stops: [
    { role: "drinks", venueId, venueName: "Olive Room", venueAddress: "10 Example Way", minutesFromStart: 0, publicNotes: "" },
    { role: "dinner", venueId, venueName: "Olive Room", venueAddress: "10 Example Way", minutesFromStart: 45, publicNotes: "Ask for the patio." },
    { role: "dessert", venueId, venueName: "Olive Room", venueAddress: "10 Example Way", minutesFromStart: 120, publicNotes: "" },
  ],
};

function principal(role: "admin" | "host" | "member", assigned: readonly string[] = []): ServerVerifiedPrincipal {
  return {
    userId: role === "admin" ? adminId : hostId, emailNormalized: `${role}@example.test`, emailVerified: true,
    staffRoles: new Set(role === "member" ? [] : [role]), admission: { state: "none", authUserId: null, emailNormalized: null },
    assignedTableIds: new Set(assigned), assignedVenueIds: new Set(),
  };
}

function revision(state: "draft" | "accepted" | "published" = "draft"): SupplyRevisionSummaryDTO {
  return { revisionId, revision: 1, state, createdAt: "2026-11-12T12:00:00Z", updatedAt: "2026-11-12T12:00:00Z", content };
}

function detail(): SupplyTableDetailDTO {
  return { providerState: "fixture", mutationsEnabled: true, tableId, lifecycle: "draft", draft: revision(), accepted: null, published: null, syncState: "current", currentSyncState: "current", canEditDraft: true, canAccept: false, canPublish: false };
}

function setup(options: Readonly<{ providerState?: "fixture" | "disabled_unmapped" | "ready" | "unavailable" }> = {}) {
  const calls = { list: 0, read: 0, venues: 0, create: 0, update: 0, preview: 0, accept: 0, publish: 0, access: 0 };
  const repository: SupplyManagementRepository = {
    async listTables() { calls.list += 1; return { providerState: "fixture", mutationsEnabled: true, canCreateDraft: true, items: [], stagedCandidates: [], nextCursor: null }; },
    async readTable() { calls.read += 1; return { detail: detail(), draftContent: content }; },
    async listVenues() { calls.venues += 1; return { providerState: "fixture", items: [] }; },
    async readDraftTableId() { calls.access += 1; return tableId; },
    async createDraft(_actor, request): Promise<SupplyCreateDraftResultDTO> { calls.create += 1; return { tableId, draft: revision() }; },
    async updateDraft() { calls.update += 1; return revision(); },
    async previewDraft() { calls.preview += 1; return { detail: detail(), draftContent: content }; },
    async acceptDraft() { calls.accept += 1; return revision("accepted"); },
    async publishDraft() { calls.publish += 1; return detail(); },
  };
  const service = createSupplyManagementService({
    resolvePrincipal: async (token) => token === "admin" ? principal("admin") : token === "host" ? principal("host", [tableId])
      : token === "other-host" ? principal("host", []) : token === "member" ? principal("member") : null,
    repository, providerState: options.providerState ?? "fixture", mutationsEnabled: (options.providerState ?? "fixture") === "fixture",
  });
  return { service, calls };
}

test("admin can list/detail/create/update/preview/accept/publish with server-only host notes", async () => {
  const { service, calls } = setup();
  const list = await service.listTables({ accessToken: "admin", limit: 25 });
  assert.equal(list.ok, true);
  if (list.ok) { assert.equal(list.value.providerState, "fixture"); assert.equal(list.value.mutationsEnabled, true); assert.equal(list.value.canCreateDraft, true); }
  const created = await service.createDraft({ accessToken: "admin", request: { operationId, source: { kind: "manual", content } } });
  assert.equal(created.ok, true);
  if (created.ok) assert.equal(created.value.tableId, tableId);
  const updated = await service.updateDraft({ accessToken: "admin", draftId: revisionId, request: { operationId, expectedDraftRevision: 1, content } });
  assert.equal(updated.ok, true);
  const preview = await service.previewDraft({ accessToken: "admin", draftId: revisionId, expectedDraftRevision: 1 });
  assert.equal(preview.ok, true);
  if (preview.ok) assert.equal(preview.value.valid, true);
  const accepted = await service.acceptDraft({ accessToken: "admin", draftId: revisionId, request: { operationId, expectedDraftRevision: 1 } });
  assert.equal(accepted.ok, true);
  const published = await service.publishDraft({ accessToken: "admin", draftId: revisionId, request: { operationId, expectedDraftRevision: 1 } });
  assert.equal(published.ok, true);
  assert.equal(calls.create, 1); assert.equal(calls.update, 1); assert.equal(calls.accept, 1); assert.equal(calls.publish, 1);
  assert.equal(content.hostNotes.includes("host stand"), true);
});

test("assigned host can read and edit own draft but cannot accept or publish", async () => {
  const { service, calls } = setup();
  const list = await service.listTables({ accessToken: "host", limit: 25 });
  assert.equal(list.ok, true);
  if (list.ok) assert.equal(list.value.canCreateDraft, false);
  const read = await service.readTable({ accessToken: "host", tableId });
  assert.equal(read.ok, true);
  if (read.ok) assert.equal(read.value.canPublish, false);
  const update = await service.updateDraft({ accessToken: "host", draftId: revisionId, request: { operationId, expectedDraftRevision: 1, content } });
  const create = await service.createDraft({ accessToken: "host", request: { operationId, source: { kind: "manual", content } } });
  assert.equal(update.ok, true);
  const accept = await service.acceptDraft({ accessToken: "host", draftId: revisionId, request: { operationId, expectedDraftRevision: 1 } });
  const publish = await service.publishDraft({ accessToken: "host", draftId: revisionId, request: { operationId, expectedDraftRevision: 1 } });
  assert.equal(create.ok, false); assert.equal(accept.ok, false); assert.equal(publish.ok, false);
  assert.equal(calls.create, 0); assert.equal(calls.update, 1); assert.equal(calls.accept, 0); assert.equal(calls.publish, 0);
});

test("host assignment is checked before read/edit and members cannot access supply", async () => {
  const { service, calls } = setup();
  const hostRead = await service.readTable({ accessToken: "other-host", tableId });
  const hostUpdate = await service.updateDraft({ accessToken: "other-host", draftId: revisionId, request: { operationId, expectedDraftRevision: 1, content } });
  const memberList = await service.listTables({ accessToken: "member", limit: 25 });
  assert.equal(hostRead.ok, false); assert.equal(hostUpdate.ok, false); assert.equal(memberList.ok, false);
  assert.equal(calls.read, 0); assert.equal(calls.update, 0);
});

test("draft mutations fail closed outside the synthetic provider while status reads remain available", async () => {
  const { service, calls } = setup({ providerState: "disabled_unmapped" });
  const read = await service.listTables({ accessToken: "admin", limit: 25 });
  const create = await service.createDraft({ accessToken: "admin", request: { operationId, source: { kind: "manual", content } } });
  assert.equal(read.ok, true);
  assert.equal(create.ok, false);
  if (!create.ok) assert.equal(create.error.code, "provider_unavailable");
  assert.equal(calls.create, 0);
});

test("bad date/time/venue inputs are rejected before repository mutation", async () => {
  const { service, calls } = setup();
  const bad = { ...content, localDate: "2026-11-01", startLocalTime: "01:30", stops: content.stops.map((stop) => ({ ...stop, venueId: "bad" })) as unknown as SupplyDraftContent["stops"] };
  const result = await service.updateDraft({ accessToken: "admin", draftId: revisionId, request: { operationId, expectedDraftRevision: 1, content: bad } });
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.error.code, "validation_failed");
  assert.equal(calls.update, 0);
});

test("an unassigned caller is refused before the mutation gate or body validation reveal anything", async () => {
  const { service } = setup({ providerState: "disabled_unmapped" });
  for (const accessToken of ["other-host", "member"]) {
    const result = await service.updateDraft({ accessToken, draftId: revisionId, request: { operationId, expectedDraftRevision: 1, content } });
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.error.code, "forbidden");
  }
});
