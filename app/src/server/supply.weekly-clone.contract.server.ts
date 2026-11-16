/** Server-only W05.3 service and persistence contracts. */

import type {
  WeeklyCloneOperationDTO,
  WeeklyCloneOperationListDTO,
  WeeklyClonePreviewDTO,
  WeeklyClonePreviewRequest,
  WeeklyCloneStartRequest,
} from "../supply.weekly-clone.contract.ts";

export type WeeklyClonePlan = Readonly<{
  weekDelta: number;
  items: WeeklyClonePreviewDTO["items"];
}>;

export interface WeeklyCloneRepository {
  preview(actorUserId: string, request: WeeklyClonePreviewRequest): Promise<WeeklyClonePlan>;
  clone(actorUserId: string, request: WeeklyCloneStartRequest): Promise<WeeklyCloneOperationDTO>;
  read(actorUserId: string, operationId: string): Promise<WeeklyCloneOperationDTO | null>;
  list(actorUserId: string, cursor: string | null, limit: number): Promise<WeeklyCloneOperationListDTO>;
  undo(actorUserId: string, operationId: string): Promise<WeeklyCloneOperationDTO>;
}

export type WeeklyCloneFailureCode =
  | "unauthenticated" | "forbidden" | "invalid_input" | "not_found"
  | "revision_conflict" | "operation_conflict" | "temporarily_unavailable";
export type WeeklyCloneFailure = Readonly<{ code: WeeklyCloneFailureCode; safeMessage: string }>;
export type WeeklyCloneResult<T> = Readonly<{ ok: true; value: T }> | Readonly<{ ok: false; error: WeeklyCloneFailure }>;

export type WeeklyClonePreviewInput = Readonly<{ accessToken?: string | null; sourceWeekStart: string; targetWeekStart: string }>;
export type WeeklyCloneStartInput = Readonly<{ accessToken?: string | null; request: WeeklyCloneStartRequest }>;
export type WeeklyCloneOperationInput = Readonly<{ accessToken?: string | null; operationId: string }>;

export type WeeklyCloneServiceDependencies = Readonly<{
  resolvePrincipal: (accessToken: string | null | undefined) => Promise<import("./authorization.server.ts").ServerVerifiedPrincipal | null>;
  repository: WeeklyCloneRepository;
}>;

export interface WeeklyCloneService {
  preview(input: WeeklyClonePreviewInput): Promise<WeeklyCloneResult<WeeklyClonePreviewDTO>>;
  clone(input: WeeklyCloneStartInput): Promise<WeeklyCloneResult<WeeklyCloneOperationDTO>>;
  readOperation(input: WeeklyCloneOperationInput): Promise<WeeklyCloneResult<WeeklyCloneOperationDTO>>;
  listOperations(input: Readonly<{ accessToken?: string | null; cursor?: string | null; limit: number }>): Promise<WeeklyCloneResult<WeeklyCloneOperationListDTO>>;
  undo(input: WeeklyCloneOperationInput): Promise<WeeklyCloneResult<WeeklyCloneOperationDTO>>;
}
