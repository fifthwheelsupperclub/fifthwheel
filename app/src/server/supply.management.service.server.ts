/** W05.2 role-aware server use cases. Provider writes remain disabled until mapping verification. */

import { authorize, type ServerVerifiedPrincipal } from "./authorization.server.ts";
import type {
  SupplyCreateInput, SupplyDetailInput, SupplyManagementFailure, SupplyManagementResult,
  SupplyManagementService, SupplyManagementServiceDependencies, SupplyPreviewInput,
  SupplyRevisionActionInput, SupplyVenueListInput, SupplyListInput, SupplyUpdateInput,
} from "./supply.management.contract.server.ts";
import type {
  SupplyDraftContent, SupplyDraftPreviewDTO, SupplyManagementErrorCode, SupplyRevisionSummaryDTO,
  SupplyTableDetailDTO, SupplyTableListDTO, SupplyVenueListDTO,
} from "../supply.management.contract.ts";
import { atlantaLocalDateTime } from "./supply.time.server.ts";
import { SupplyManagementRepositoryError } from "./supply.management.repository.server.ts";

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const stopRoles = ["drinks", "dinner", "dessert"] as const;
type PreviewValidation = Readonly<{ issues: SupplyDraftPreviewDTO["issues"]; startsAt: string | null }>;

function fail(code: SupplyManagementErrorCode, safeMessage: string, fields?: Readonly<Record<string, string>>): SupplyManagementResult<never> {
  return { ok: false, error: { code, safeMessage, ...(fields ? { fields } : {}) } };
}

function repositoryFailure(error: unknown): SupplyManagementResult<never> {
  if (error instanceof SupplyManagementRepositoryError) {
    switch (error.code) {
      case "forbidden": return fail("forbidden", "You are not allowed to access this supply record.");
      case "not_found": return fail("not_found", "The supply record could not be found.");
      case "revision_conflict": return fail("revision_conflict", "This draft changed. Reload it and review the latest version.");
      case "protected_change": return fail("protected_change", "This published Table has active invitations or paid Seats; schedule and venue changes require cancellation and a new Table.");
      case "operation_conflict": return fail("operation_conflict", "This operation identifier was already used for a different change.");
      case "provider_unavailable": return fail("provider_unavailable", "Supply changes are unavailable until provider mappings are verified.");
      case "validation_failed": return fail("validation_failed", "Review the highlighted fields and try again.");
      case "configuration_invalid":
      case "request_failed":
      case "response_invalid": return fail("temporarily_unavailable", "Supply management is temporarily unavailable.");
    }
  }
  return fail("temporarily_unavailable", "Supply management is temporarily unavailable.");
}

function isAdmin(principal: ServerVerifiedPrincipal): boolean {
  return principal.staffRoles.has("admin");
}

function canReadSupply(principal: ServerVerifiedPrincipal): boolean {
  return principal.emailVerified && (isAdmin(principal) || principal.staffRoles.has("host"));
}

function normalizeInputContent(content: SupplyDraftContent): SupplyDraftContent {
  return Object.freeze({
    title: content.title.trim(), localDate: content.localDate.trim(), startLocalTime: content.startLocalTime.trim(),
    neighborhood: content.neighborhood.trim(), hostNotes: content.hostNotes.trim(),
    stops: content.stops.map((stop) => Object.freeze({
      role: stop.role, venueId: stop.venueId.trim(), venueName: stop.venueName.trim(),
      venueAddress: stop.venueAddress.trim(), minutesFromStart: stop.minutesFromStart,
      publicNotes: stop.publicNotes.trim(),
    })) as unknown as SupplyDraftContent["stops"],
  });
}

function isDraftContent(value: unknown): value is SupplyDraftContent {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const content = value as Record<string, unknown>;
  if (typeof content.title !== "string" || typeof content.localDate !== "string" || typeof content.startLocalTime !== "string"
    || typeof content.neighborhood !== "string" || typeof content.hostNotes !== "string" || !Array.isArray(content.stops) || content.stops.length !== 3) return false;
  return content.stops.every((raw, index) => {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return false;
    const stop = raw as Record<string, unknown>;
    return stop.role === stopRoles[index] && typeof stop.venueId === "string" && typeof stop.venueName === "string"
      && typeof stop.venueAddress === "string" && Number.isInteger(stop.minutesFromStart) && typeof stop.publicNotes === "string";
  });
}

function validateContent(content: SupplyDraftContent): PreviewValidation {
  const issues: SupplyDraftPreviewDTO["issues"][number][] = [];
  if (typeof content.title !== "string" || content.title.trim().length < 3 || content.title.trim().length > 180) {
    issues.push({ field: "title", code: "required", message: "Enter a Table title between 3 and 180 characters." });
  }
  if (typeof content.neighborhood !== "string" || content.neighborhood.trim().length < 2 || content.neighborhood.trim().length > 120) {
    issues.push({ field: "neighborhood", code: "required", message: "Enter a neighborhood." });
  }
  if (typeof content.hostNotes !== "string" || content.hostNotes.length > 2000) {
    issues.push({ field: "venue", code: "required", message: "Host notes must be 2,000 characters or fewer." });
  }
  const schedule = atlantaLocalDateTime(content.localDate, content.startLocalTime);
  if (!schedule.ok) {
    const code = schedule.code;
    issues.push({ field: "schedule", code: code === "invalid_date" ? "invalid_date" : code, message: "Enter a real Atlanta local date and time; daylight-saving gaps and repeated times must be corrected." });
  }
  if (!Array.isArray(content.stops) || content.stops.length !== 3 || content.stops.some((stop, index) => !stop || stop.role !== stopRoles[index])) {
    issues.push({ field: "stops", code: "invalid_stop_set", message: "Add exactly three stops in drinks, dinner, dessert order." });
  } else {
    for (const stop of content.stops) {
      if (!uuidPattern.test(stop.venueId) || stop.venueName.trim().length === 0 || stop.venueName.length > 180 || stop.venueAddress.trim().length === 0 || stop.venueAddress.length > 400) {
        issues.push({ field: "venue", code: "missing_venue", stopRole: stop.role, message: `Select a valid venue for the ${stop.role} stop.` });
      }
      if (!Number.isInteger(stop.minutesFromStart) || stop.minutesFromStart < 0 || stop.minutesFromStart > 720 || stop.publicNotes.length > 500) {
        issues.push({ field: "stops", code: "invalid_stop_set", stopRole: stop.role, message: `Check the ${stop.role} stop timing and notes.` });
      }
    }
    if (content.stops[0].minutesFromStart > content.stops[1].minutesFromStart || content.stops[1].minutesFromStart > content.stops[2].minutesFromStart) {
      issues.push({ field: "stops", code: "invalid_stop_set", message: "Stop times must follow the itinerary order." });
    }
  }
  return { issues: Object.freeze(issues), startsAt: schedule.ok ? schedule.instant : null };
}

function compareContent(before: SupplyDraftContent | null, after: SupplyDraftContent): SupplyDraftPreviewDTO["changes"] {
  if (!before) return Object.freeze([{ field: "new_table", before: null, after: after.title }]);
  const changes: { field: string; before: string | null; after: string | null }[] = [];
  const fields: (keyof SupplyDraftContent)[] = ["title", "localDate", "startLocalTime", "neighborhood", "hostNotes"];
  for (const field of fields) {
    if (before[field] !== after[field]) changes.push({ field, before: String(before[field]), after: String(after[field]) });
  }
  for (let index = 0; index < 3; index += 1) {
    const oldStop = before.stops[index]!, newStop = after.stops[index]!;
    for (const field of ["venueId", "minutesFromStart", "publicNotes"] as const) {
      if (oldStop[field] !== newStop[field]) changes.push({ field: `stops.${newStop.role}.${field}`, before: String(oldStop[field]), after: String(newStop[field]) });
    }
  }
  return Object.freeze(changes);
}

export function createSupplyManagementService(dependencies: SupplyManagementServiceDependencies): SupplyManagementService {
  async function principal(token: string | null | undefined): Promise<ServerVerifiedPrincipal | null> {
    try { return await dependencies.resolvePrincipal(token); } catch { return null; }
  }
  function mutationsAvailable(): boolean { return dependencies.mutationsEnabled && dependencies.providerState === "fixture"; }
  function tableAccess(actor: ServerVerifiedPrincipal, tableId: string): boolean {
    if (isAdmin(actor)) return true;
    return authorize(actor, { workspace: "host", action: "supply:draft", tableId }).allowed;
  }
  async function authorizeDraft(actor: ServerVerifiedPrincipal, draftId: string): Promise<string | null> {
    if (isAdmin(actor)) return "admin";
    if (!actor.emailVerified || !actor.staffRoles.has("host")) return null;
    const tableId = await dependencies.repository.readDraftTableId(actor.userId, draftId);
    return tableId && tableAccess(actor, tableId) ? tableId : null;
  }

  return Object.freeze({
    async listTables(input: SupplyListInput): Promise<SupplyManagementResult<SupplyTableListDTO>> {
      const actor = await principal(input.accessToken);
      if (!actor) return fail("unauthenticated", "Sign in to continue.");
      if (!canReadSupply(actor)) return fail("forbidden", "You are not allowed to view supply.");
      try {
        const result = await dependencies.repository.listTables(actor.userId, [...actor.assignedTableIds], input);
        return { ok: true, value: Object.freeze({ ...result, providerState: dependencies.providerState, mutationsEnabled: mutationsAvailable(), canCreateDraft: isAdmin(actor) }) };
      } catch (error) { return repositoryFailure(error); }
    },

    async readTable(input: SupplyDetailInput): Promise<SupplyManagementResult<SupplyTableDetailDTO>> {
      const actor = await principal(input.accessToken);
      if (!actor) return fail("unauthenticated", "Sign in to continue.");
      if (!uuidPattern.test(input.tableId)) return fail("invalid_input", "Use a valid Table identifier.");
      if (!tableAccess(actor, input.tableId)) return fail("forbidden", "You are not assigned to this supply record.");
      try {
        const stored = await dependencies.repository.readTable(actor.userId, input.tableId);
        if (!stored) return fail("not_found", "The supply record could not be found.");
        return { ok: true, value: Object.freeze({ ...stored.detail, providerState: dependencies.providerState, mutationsEnabled: mutationsAvailable() }) };
      } catch (error) { return repositoryFailure(error); }
    },

    async listVenues(input: SupplyVenueListInput): Promise<SupplyManagementResult<SupplyVenueListDTO>> {
      const actor = await principal(input.accessToken);
      if (!actor) return fail("unauthenticated", "Sign in to continue.");
      if (!canReadSupply(actor)) return fail("forbidden", "You are not allowed to view supply venues.");
      try {
        const result = await dependencies.repository.listVenues(actor.userId, [...actor.assignedTableIds], input.query);
        return { ok: true, value: Object.freeze({ ...result, providerState: dependencies.providerState }) };
      } catch (error) { return repositoryFailure(error); }
    },

    async createDraft(input: SupplyCreateInput) {
      const actor = await principal(input.accessToken);
      if (!actor) return fail("unauthenticated", "Sign in to continue.");
      if (!isAdmin(actor)) return fail("forbidden", "Only an admin may create a supply draft.");
      if (!mutationsAvailable()) return fail("provider_unavailable", "Draft mutations are enabled only for local synthetic supply until Airtable mappings are verified.");
      if (!uuidPattern.test(input.request.operationId)) return fail("invalid_input", "Use a valid operation identifier.");
      const source = input.request.source;
      if (source.kind === "manual") {
        if (!isAdmin(actor)) return fail("forbidden", "Hosts cannot create unassigned Tables.");
        if (!isDraftContent(source.content)) return fail("invalid_input", "Check the draft fields and try again.");
        const normalizedContent = normalizeInputContent(source.content);
        const validation = validateContent(normalizedContent);
        if (validation.issues.length) return fail("validation_failed", "Complete the required Table fields before creating a draft.", Object.fromEntries(validation.issues.map((issue) => [issue.field, issue.message])));
        input = { ...input, request: { ...input.request, source: { kind: "manual", content: normalizedContent } } };
      } else {
        if (!uuidPattern.test(source.revisionId) || !uuidPattern.test(source.tableId)) return fail("invalid_input", "Select a valid staged candidate.");
        if (!tableAccess(actor, source.tableId)) return fail("forbidden", "You are not assigned to this staged Table.");
      }
      try { return { ok: true as const, value: await dependencies.repository.createDraft(actor.userId, input.request) }; }
      catch (error) { return repositoryFailure(error); }
    },

    async updateDraft(input: SupplyUpdateInput) {
      const actor = await principal(input.accessToken);
      if (!actor) return fail("unauthenticated", "Sign in to continue.");
      if (!uuidPattern.test(input.draftId) || !uuidPattern.test(input.request.operationId) || !Number.isInteger(input.request.expectedDraftRevision) || input.request.expectedDraftRevision < 1) return fail("invalid_input", "Check the draft and operation identifiers.");
      if (!mutationsAvailable()) return fail("provider_unavailable", "Draft mutations are enabled only for local synthetic supply until Airtable mappings are verified.");
      if (!isDraftContent(input.request.content)) return fail("invalid_input", "Check the draft fields and try again.");
      try {
        if (!(await authorizeDraft(actor, input.draftId))) return fail("forbidden", "You are not assigned to this draft.");
        const normalized = normalizeInputContent(input.request.content);
        const validation = validateContent(normalized);
        if (validation.issues.length) return fail("validation_failed", "Correct the highlighted fields before saving.", Object.fromEntries(validation.issues.map((issue) => [issue.field, issue.message])));
        return { ok: true as const, value: await dependencies.repository.updateDraft(actor.userId, input.draftId, { ...input.request, content: normalized }) };
      } catch (error) { return repositoryFailure(error); }
    },

    async previewDraft(input: SupplyPreviewInput) {
      const actor = await principal(input.accessToken);
      if (!actor) return fail("unauthenticated", "Sign in to continue.");
      if (!uuidPattern.test(input.draftId) || !Number.isInteger(input.expectedDraftRevision) || input.expectedDraftRevision < 1) return fail("invalid_input", "Check the draft and revision.");
      try {
        const tableId = await authorizeDraft(actor, input.draftId);
        if (!tableId) return fail("forbidden", "You are not assigned to this draft.");
        const stored = await dependencies.repository.previewDraft(actor.userId, input.draftId, input.expectedDraftRevision);
        if (!stored) return fail("not_found", "The draft could not be found.");
        const content = stored.draftContent;
        if (!content) return fail("not_found", "The draft could not be found.");
        const validation = validateContent(content);
        const isAdminActor = isAdmin(actor);
        const canAccept = isAdminActor && mutationsAvailable() && validation.issues.length === 0;
        const canPublish = isAdminActor && mutationsAvailable() && validation.issues.length === 0
          && stored.detail.accepted?.revisionId === stored.detail.draft?.revisionId;
        const preview: SupplyDraftPreviewDTO = Object.freeze({
          tableId, draftRevision: input.expectedDraftRevision, valid: validation.issues.length === 0,
          startsAt: validation.startsAt,
          changes: compareContent(stored.detail.published?.content ?? null, content),
          issues: validation.issues, canAccept, canPublish, providerState: dependencies.providerState,
        });
        return { ok: true as const, value: preview };
      } catch (error) { return repositoryFailure(error); }
    },

    async acceptDraft(input: SupplyRevisionActionInput) {
      const actor = await principal(input.accessToken);
      if (!actor) return fail("unauthenticated", "Sign in to continue.");
      if (!isAdmin(actor)) return fail("forbidden", "Only an admin may accept a supply revision.");
      if (!mutationsAvailable()) return fail("provider_unavailable", "Acceptance is enabled only for local synthetic supply until Airtable mappings are verified.");
      if (!uuidPattern.test(input.draftId) || !uuidPattern.test(input.request.operationId) || !Number.isInteger(input.request.expectedDraftRevision) || input.request.expectedDraftRevision < 1) return fail("invalid_input", "Check the draft and revision.");
      try { return { ok: true as const, value: await dependencies.repository.acceptDraft(actor.userId, input.draftId, input.request) }; }
      catch (error) { return repositoryFailure(error); }
    },

    async publishDraft(input: SupplyRevisionActionInput) {
      const actor = await principal(input.accessToken);
      if (!actor) return fail("unauthenticated", "Sign in to continue.");
      if (!isAdmin(actor)) return fail("forbidden", "Only an admin may publish supply.");
      if (!mutationsAvailable()) return fail("provider_unavailable", "Publication is enabled only for local synthetic supply until Airtable mappings are verified.");
      if (!uuidPattern.test(input.draftId) || !uuidPattern.test(input.request.operationId) || !Number.isInteger(input.request.expectedDraftRevision) || input.request.expectedDraftRevision < 1) return fail("invalid_input", "Check the draft and revision.");
      try {
        const detail = await dependencies.repository.publishDraft(actor.userId, input.draftId, input.request);
        return { ok: true as const, value: Object.freeze({ ...detail, providerState: dependencies.providerState, mutationsEnabled: mutationsAvailable() }) };
      }
      catch (error) { return repositoryFailure(error); }
    },
  });
}
