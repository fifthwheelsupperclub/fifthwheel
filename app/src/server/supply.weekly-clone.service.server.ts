/** W05.3 server use cases for preview, durable clone, recovery, and guarded undo. */

import type {
  WeeklyCloneOperationDTO, WeeklyClonePreviewDTO,
} from "../supply.weekly-clone.contract.ts";
import { authorize } from "./authorization.server.ts";
import type {
  WeeklyCloneFailureCode, WeeklyCloneProviderLookup, WeeklyCloneResult,
  WeeklyCloneOperationInput, WeeklyClonePreviewInput, WeeklyCloneStartInput, WeeklyCloneUndoInput,
  WeeklyCloneService, WeeklyCloneServiceDependencies,
} from "./supply.weekly-clone.contract.server.ts";
import { WeeklyCloneRepositoryError } from "./supply.weekly-clone.repository.server.ts";

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function failure<T = never>(code: WeeklyCloneFailureCode, safeMessage: string): WeeklyCloneResult<T> {
  return { ok: false, error: { code, safeMessage } };
}

function validDate(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(0);
  date.setUTCFullYear(year!, month! - 1, day!);
  date.setUTCHours(0, 0, 0, 0);
  return date.toISOString().slice(0, 10) === value;
}

function isMonday(value: string): boolean { return new Date(`${value}T00:00:00Z`).getUTCDay() === 1; }

function validWeeks(sourceWeekStart: unknown, targetWeekStart: unknown): sourceWeekStart is string {
  return validDate(sourceWeekStart) && validDate(targetWeekStart) && isMonday(sourceWeekStart) && isMonday(targetWeekStart) && sourceWeekStart !== targetWeekStart;
}

function weekDelta(source: string, target: string): number {
  return (Date.parse(`${target}T00:00:00Z`) - Date.parse(`${source}T00:00:00Z`)) / 604_800_000;
}

function mapRepoError(error: unknown): WeeklyCloneResult<never> {
  if (error instanceof WeeklyCloneRepositoryError) {
    if (error.code === "forbidden") return failure("forbidden", "You are not allowed to manage weekly supply clones.");
    if (error.code === "not_found") return failure("not_found", "The weekly clone operation could not be found.");
    if (error.code === "revision_conflict") return failure("revision_conflict", "The source drafts changed. Preview the week again before cloning.");
    if (error.code === "operation_conflict") return failure("operation_conflict", "That operation identifier is already bound to a different request.");
    if (error.code === "operation_unresolved") return failure("revision_conflict", "Reconcile the unresolved operation before retrying.");
    if (error.code === "undo_refused") return failure("revision_conflict", "The clone changed or became active, so it can no longer be undone.");
  }
  return failure("temporarily_unavailable", "Weekly supply is temporarily unavailable. Try again shortly.");
}

function asLookup(result: WeeklyCloneProviderLookup, expectedHash: string): WeeklyCloneProviderLookup {
  if (result.state === "found" && result.contentHash !== expectedHash) return { state: "conflict" };
  return result;
}

export function createWeeklyCloneService(dependencies: WeeklyCloneServiceDependencies): WeeklyCloneService {
  async function admin(accessToken: string | null | undefined) {
    let principal;
    try { principal = await dependencies.resolvePrincipal(accessToken); }
    catch { return { ok: false as const, reason: "temporarily_unavailable" as const, userId: null }; }
    const decision = authorize(principal, { workspace: "admin", action: "supply:clone" });
    if (!decision.allowed) return { ok: false as const, reason: decision.reason, userId: null };
    return { ok: true as const, reason: "allowed" as const, userId: decision.principal.userId };
  }

  function authFailure(reason: string): WeeklyCloneResult<never> {
    if (reason === "unauthenticated" || reason === "email-unverified") return failure("unauthenticated", "Sign in with a verified staff account.");
    if (reason === "temporarily_unavailable") return failure("temporarily_unavailable", "Your access could not be verified. Try again shortly.");
    return failure("forbidden", "You are not allowed to manage weekly supply clones.");
  }

  function addProviderState(operation: WeeklyCloneOperationDTO): WeeklyCloneOperationDTO {
    return Object.freeze({ ...operation, providerState: dependencies.provider.state, mutationsEnabled: dependencies.mutationsEnabled && dependencies.provider.state === "fixture" });
  }

  async function processCreateWork(actorId: string, operationId: string): Promise<WeeklyCloneOperationDTO> {
    while (true) {
      const work = await dependencies.repository.claimNext(actorId, operationId);
      if (!work) break;
      let result: { state: "created" | "failed" | "outcome_unknown" | "conflict"; providerRecordId?: string };
      try {
        const providerResult = await dependencies.provider.create({ actorUserId: actorId, markerId: work.markerId, sourceRecordId: work.sourceRecordId, content: work.content, contentHash: work.contentHash });
        result = providerResult.state === "created" && providerResult.providerRecordId
          ? { state: "created", providerRecordId: providerResult.providerRecordId }
          : providerResult.state === "conflict" ? { state: "conflict" }
            : providerResult.state === "failed" ? { state: "failed" } : { state: "outcome_unknown" };
      } catch { result = { state: "outcome_unknown" }; }
      const operation = await dependencies.repository.finishCreate(actorId, work, result);
      if (result.state === "outcome_unknown") return addProviderState(operation);
    }
    const operation = await dependencies.repository.read(actorId, operationId);
    if (!operation) throw new WeeklyCloneRepositoryError("not_found");
    return addProviderState(operation);
  }

  return Object.freeze({
    async preview(input: WeeklyClonePreviewInput): Promise<WeeklyCloneResult<WeeklyClonePreviewDTO>> {
      const decision = await admin(input.accessToken);
      if (!decision.ok) return authFailure(decision.reason);
      if (!validWeeks(input.sourceWeekStart, input.targetWeekStart)) return failure("invalid_input", "Choose different Monday week starts using Atlanta local dates.");
      try {
        const plan = await dependencies.repository.preview(decision.userId, input);
        const items = plan.items.map((item) => Object.freeze({
          sourceTableId: item.sourceTableId,
          sourceRevisionId: item.sourceRevisionId,
          sourceRevision: item.sourceRevision,
          sourceHash: item.sourceHash,
          title: item.title,
          sourceLocalDate: item.sourceLocalDate,
          targetLocalDate: item.targetLocalDate,
          eligibility: item.eligibility,
          conflictCode: item.conflictCode as WeeklyClonePreviewDTO["items"][number]["conflictCode"],
        }));
        const eligibleCount = items.filter((item) => item.eligibility === "eligible").length;
        return { ok: true, value: Object.freeze({ providerState: dependencies.provider.state, mutationsEnabled: dependencies.mutationsEnabled && dependencies.provider.state === "fixture",
          weekStartPolicy: "monday", sourceWeekStart: input.sourceWeekStart, targetWeekStart: input.targetWeekStart, weekDelta: plan.weekDelta,
          planHash: plan.planHash, items: Object.freeze(items), eligibleCount, conflictCount: items.length - eligibleCount }) };
      } catch (error) { return mapRepoError(error); }
    },

    async clone(input: WeeklyCloneStartInput): Promise<WeeklyCloneResult<WeeklyCloneOperationDTO>> {
      const decision = await admin(input.accessToken);
      if (!decision.ok) return authFailure(decision.reason);
      const request = input.request;
      if (!uuidPattern.test(request.operationId) || !/^[a-f0-9]{32}$/.test(request.expectedPlanHash) || !validWeeks(request.sourceWeekStart, request.targetWeekStart)) {
        return failure("invalid_input", "Check the operation identifier, plan, and Monday week starts.");
      }
      if (!dependencies.mutationsEnabled || dependencies.provider.state !== "fixture") return failure("provider_unavailable", "Weekly cloning is enabled only for local synthetic supply until Airtable mappings and operation markers are verified.");
      try {
        const plan = await dependencies.repository.preview(decision.userId, request);
        // Existing operation replays are handled by the DB before stale-plan validation;
        // a new operation must match the current immutable plan hash.
        const operation = await dependencies.repository.begin(decision.userId, request, plan);
        if (operation.state === "outcome_unknown" || operation.state === "undoing" || operation.state === "undo_unknown" || operation.state === "undone") return { ok: true, value: addProviderState(operation) };
        return { ok: true, value: await processCreateWork(decision.userId, request.operationId) };
      } catch (error) { return mapRepoError(error); }
    },

    async readOperation(input: WeeklyCloneOperationInput): Promise<WeeklyCloneResult<WeeklyCloneOperationDTO>> {
      const decision = await admin(input.accessToken);
      if (!decision.ok) return authFailure(decision.reason);
      if (!uuidPattern.test(input.operationId)) return failure("invalid_input", "Use a valid operation identifier.");
      try {
        const operation = await dependencies.repository.read(decision.userId, input.operationId);
        return operation ? { ok: true, value: addProviderState(operation) } : failure("not_found", "The weekly clone operation could not be found.");
      } catch (error) { return mapRepoError(error); }
    },

    async listOperations(input: Readonly<{ accessToken?: string | null; cursor?: string | null; limit: number }>) {
      const decision = await admin(input.accessToken);
      if (!decision.ok) return authFailure(decision.reason);
      if (!Number.isInteger(input.limit) || input.limit < 1 || input.limit > 50
        || (input.cursor != null && (input.cursor.length > 120 || !/^[0-9TZ:.-]+\|[0-9a-f-]{36}$/i.test(input.cursor)))) {
        return failure("invalid_input", "Check the operation history page request.");
      }
      try {
        const result = await dependencies.repository.list(decision.userId, input.cursor ?? null, input.limit);
        return { ok: true as const, value: Object.freeze({ ...result, providerState: dependencies.provider.state, mutationsEnabled: dependencies.mutationsEnabled && dependencies.provider.state === "fixture" }) };
      } catch (error) { return mapRepoError(error); }
    },

    async reconcile(input: WeeklyCloneOperationInput): Promise<WeeklyCloneResult<WeeklyCloneOperationDTO>> {
      const decision = await admin(input.accessToken);
      if (!decision.ok) return authFailure(decision.reason);
      if (!uuidPattern.test(input.operationId)) return failure("invalid_input", "Use a valid operation identifier.");
      if (!dependencies.mutationsEnabled || dependencies.provider.state !== "fixture") return failure("provider_unavailable", "Operation reconciliation is unavailable until the configured provider can be checked safely.");
      try {
        const unresolved = await dependencies.repository.readUnresolved(decision.userId, input.operationId);
        for (const work of unresolved) {
          if (work.state === "undoing" || work.state === "undo_unknown") {
            if (!work.providerRecordId) continue;
            const lookup = asLookup(await dependencies.provider.reconcileDelete({ actorUserId: decision.userId, markerId: work.markerId, providerRecordId: work.providerRecordId, contentHash: work.contentHash }), work.contentHash);
            await dependencies.repository.reconcileDelete(decision.userId, work, lookup);
          } else {
            const lookup = asLookup(await dependencies.provider.reconcileCreate({ actorUserId: decision.userId, markerId: work.markerId, sourceRecordId: work.sourceRecordId, contentHash: work.contentHash }), work.contentHash);
            await dependencies.repository.reconcileCreate(decision.userId, work, lookup);
          }
        }
        const operation = await dependencies.repository.read(decision.userId, input.operationId);
        return operation ? { ok: true, value: addProviderState(operation) } : failure("not_found", "The weekly clone operation could not be found.");
      } catch (error) { return mapRepoError(error); }
    },

    async undo(input: WeeklyCloneUndoInput): Promise<WeeklyCloneResult<WeeklyCloneOperationDTO>> {
      const decision = await admin(input.accessToken);
      if (!decision.ok) return authFailure(decision.reason);
      if (!uuidPattern.test(input.operationId) || !uuidPattern.test(input.request.undoOperationId) || !Number.isInteger(input.request.expectedManifestRevision) || input.request.expectedManifestRevision < 1) {
        return failure("invalid_input", "Check the operation ID and manifest revision.");
      }
      if (!dependencies.mutationsEnabled || dependencies.provider.state !== "fixture") return failure("provider_unavailable", "Weekly clone undo is enabled only in the local synthetic supply provider.");
      try {
        const started = await dependencies.repository.beginUndo(decision.userId, input.operationId, input.request);
        for (const work of started.items) {
          if (work.state === "undo_unknown") break;
          if (!work.providerRecordId) {
            await dependencies.repository.finishUndo(decision.userId, work, { state: "undo_refused" });
            break;
          }
          let state: "undone" | "undo_refused" | "undo_unknown";
          try {
            const deleteResult = await dependencies.provider.delete({ actorUserId: decision.userId, markerId: work.markerId, providerRecordId: work.providerRecordId, contentHash: work.contentHash });
            state = deleteResult === "deleted" ? "undone" : deleteResult === "outcome_unknown" ? "undo_unknown" : "undo_refused";
          } catch { state = "undo_unknown"; }
          await dependencies.repository.finishUndo(decision.userId, work, { state });
          if (state === "undo_unknown" || state === "undo_refused") break;
        }
        const operation = await dependencies.repository.read(decision.userId, input.operationId);
        return operation ? { ok: true, value: addProviderState(operation) } : failure("not_found", "The weekly clone operation could not be found.");
      } catch (error) { return mapRepoError(error); }
    },
  });
}
