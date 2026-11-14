/** Server-only W05.3 provider, service and persistence contracts. */

import type {
  SupplyDraftContent,
} from "../supply.management.contract.ts";
import type {
  WeeklyCloneOperationDTO,
  WeeklyCloneOperationListDTO,
  WeeklyClonePreviewDTO,
  WeeklyCloneStartRequest,
  WeeklyCloneUndoRequest,
} from "../supply.weekly-clone.contract.ts";

export type WeeklyClonePlanItem = Readonly<{
  sourceTableId: string;
  sourceRevisionId: string;
  sourceRevision: number;
  sourceHash: string;
  content: SupplyDraftContent;
  targetContent: SupplyDraftContent;
  title: string;
  sourceLocalDate: string;
  targetLocalDate: string;
  eligibility: "eligible" | "conflict";
  conflictCode: string | null;
}>;

export type WeeklyClonePlan = Readonly<{
  planHash: string;
  weekDelta: number;
  items: readonly WeeklyClonePlanItem[];
}>;

export type WeeklyCloneProviderCreateResult = Readonly<{
  state: "created" | "outcome_unknown" | "failed" | "conflict";
  providerRecordId?: string;
}>;

export type WeeklyCloneProviderLookup =
  | Readonly<{ state: "found"; providerRecordId: string; contentHash: string }>
  | Readonly<{ state: "absent" }>
  | Readonly<{ state: "unknown" }>
  | Readonly<{ state: "conflict" }>;

export type WeeklyCloneProviderDeleteResult = "deleted" | "outcome_unknown" | "failed";

export interface WeeklyCloneProvider {
  readonly state: "fixture" | "ready" | "disabled_unmapped" | "unavailable";
  create(input: Readonly<{ actorUserId: string; markerId: string; sourceRecordId: string | null; content: SupplyDraftContent; contentHash: string }>): Promise<WeeklyCloneProviderCreateResult>;
  reconcileCreate(input: Readonly<{ actorUserId: string; markerId: string; sourceRecordId: string | null; contentHash: string }>): Promise<WeeklyCloneProviderLookup>;
  delete(input: Readonly<{ actorUserId: string; markerId: string; providerRecordId: string; contentHash: string }>): Promise<WeeklyCloneProviderDeleteResult>;
  reconcileDelete(input: Readonly<{ actorUserId: string; markerId: string; providerRecordId: string; contentHash: string }>): Promise<WeeklyCloneProviderLookup>;
}

export type WeeklyCloneItemWork = Readonly<{
  operationId: string;
  sourceTableId: string;
  sourceRevisionId: string;
  sourceRecordId: string | null;
  targetTableId: string;
  markerId: string;
  content: SupplyDraftContent;
  contentHash: string;
  state: "pending" | "creating" | "created" | "failed" | "outcome_unknown" | "undoing" | "undone" | "undo_unknown" | "undo_refused";
  providerRecordId: string | null;
}>;

export interface WeeklyCloneRepository {
  preview(actorUserId: string, request: Readonly<{ sourceWeekStart: string; targetWeekStart: string }>): Promise<WeeklyClonePlan>;
  begin(actorUserId: string, request: WeeklyCloneStartRequest, plan: WeeklyClonePlan): Promise<WeeklyCloneOperationDTO>;
  claimNext(actorUserId: string, operationId: string): Promise<WeeklyCloneItemWork | null>;
  finishCreate(actorUserId: string, work: WeeklyCloneItemWork, result: Readonly<{ state: "created" | "failed" | "outcome_unknown" | "conflict"; providerRecordId?: string }>): Promise<WeeklyCloneOperationDTO>;
  read(actorUserId: string, operationId: string): Promise<WeeklyCloneOperationDTO | null>;
  list(actorUserId: string, cursor: string | null, limit: number): Promise<WeeklyCloneOperationListDTO>;
  readUnresolved(actorUserId: string, operationId: string): Promise<readonly WeeklyCloneItemWork[]>;
  beginUndo(actorUserId: string, operationId: string, request: WeeklyCloneUndoRequest): Promise<Readonly<{ operation: WeeklyCloneOperationDTO; items: readonly WeeklyCloneItemWork[] }>>;
  finishUndo(actorUserId: string, work: WeeklyCloneItemWork, result: Readonly<{ state: "undone" | "undo_refused" | "undo_unknown" }>): Promise<WeeklyCloneOperationDTO>;
  reconcileCreate(actorUserId: string, work: WeeklyCloneItemWork, lookup: WeeklyCloneProviderLookup): Promise<WeeklyCloneOperationDTO>;
  reconcileDelete(actorUserId: string, work: WeeklyCloneItemWork, lookup: WeeklyCloneProviderLookup): Promise<WeeklyCloneOperationDTO>;
}

export type WeeklyCloneFailureCode =
  | "unauthenticated" | "forbidden" | "invalid_input" | "not_found"
  | "revision_conflict" | "operation_conflict" | "provider_unavailable"
  | "temporarily_unavailable";
export type WeeklyCloneFailure = Readonly<{ code: WeeklyCloneFailureCode; safeMessage: string }>;
export type WeeklyCloneResult<T> = Readonly<{ ok: true; value: T }> | Readonly<{ ok: false; error: WeeklyCloneFailure }>;

export type WeeklyClonePreviewInput = Readonly<{ accessToken?: string | null; sourceWeekStart: string; targetWeekStart: string }>;
export type WeeklyCloneStartInput = Readonly<{ accessToken?: string | null; request: WeeklyCloneStartRequest }>;
export type WeeklyCloneOperationInput = Readonly<{ accessToken?: string | null; operationId: string }>;
export type WeeklyCloneUndoInput = Readonly<{ accessToken?: string | null; operationId: string; request: WeeklyCloneUndoRequest }>;

export type WeeklyCloneServiceDependencies = Readonly<{
  resolvePrincipal: (accessToken: string | null | undefined) => Promise<import("./authorization.server.ts").ServerVerifiedPrincipal | null>;
  repository: WeeklyCloneRepository;
  provider: WeeklyCloneProvider;
  mutationsEnabled: boolean;
}>;

export interface WeeklyCloneService {
  preview(input: WeeklyClonePreviewInput): Promise<WeeklyCloneResult<WeeklyClonePreviewDTO>>;
  clone(input: WeeklyCloneStartInput): Promise<WeeklyCloneResult<WeeklyCloneOperationDTO>>;
  readOperation(input: WeeklyCloneOperationInput): Promise<WeeklyCloneResult<WeeklyCloneOperationDTO>>;
  listOperations(input: Readonly<{ accessToken?: string | null; cursor?: string | null; limit: number }>): Promise<WeeklyCloneResult<WeeklyCloneOperationListDTO>>;
  reconcile(input: WeeklyCloneOperationInput): Promise<WeeklyCloneResult<WeeklyCloneOperationDTO>>;
  undo(input: WeeklyCloneUndoInput): Promise<WeeklyCloneResult<WeeklyCloneOperationDTO>>;
}
