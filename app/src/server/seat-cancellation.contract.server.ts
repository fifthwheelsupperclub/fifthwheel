/** W07.4 service-only cancellation request/review contracts. */

import type {
  AdminCancellationDetailDTO, AdminCancellationQueueDTO, CancellationErrorCode,
  DecideCancellationInput, MemberCancellationHistoryDTO, MemberCancellationRequestDTO, RequestCancellationInput,
} from "../seat-cancellation.contract.ts";

export type CancellationFailure = Readonly<{ code: CancellationErrorCode; safeMessage: string; retryable: boolean }>;
export type CancellationResult<T> =
  | Readonly<{ ok: true; value: T }>
  | Readonly<{ ok: false; error: CancellationFailure }>;

export type OwnCancellationHistoryInput = Readonly<{ accessToken?: string | null; seatId: string }>;
export type RequestCancellationServiceInput = OwnCancellationHistoryInput & Readonly<{ request: RequestCancellationInput }>;
export type AdminCancellationQueueInput = Readonly<{ accessToken?: string | null; cursor?: string | null; limit?: number }>;
export type AdminCancellationInput = Readonly<{ accessToken?: string | null; requestId: string }>;
export type DecideCancellationServiceInput = AdminCancellationInput & Readonly<{ request: DecideCancellationInput }>;
export type AdminCancellationCursor = Readonly<{ requestedAt: string; requestId: string }>;

export interface SeatCancellationRepository {
  listOwnCancellationRequests(actorUserId: string, seatId: string): Promise<MemberCancellationHistoryDTO>;
  requestCancellation(actorUserId: string, seatId: string, request: Readonly<{ operationId: string; memberReason: string | null }>): Promise<MemberCancellationRequestDTO>;
  listAdminCancellations(actorUserId: string, cursor: AdminCancellationCursor | null, limit: number): Promise<AdminCancellationQueueDTO>;
  readAdminCancellation(actorUserId: string, requestId: string): Promise<AdminCancellationDetailDTO>;
  decideCancellation(actorUserId: string, requestId: string, request: DecideCancellationInput): Promise<AdminCancellationDetailDTO>;
}

export interface SeatCancellationService {
  listOwnCancellationRequests(input: OwnCancellationHistoryInput): Promise<CancellationResult<MemberCancellationHistoryDTO>>;
  requestCancellation(input: RequestCancellationServiceInput): Promise<CancellationResult<MemberCancellationRequestDTO>>;
  listAdminCancellations(input: AdminCancellationQueueInput): Promise<CancellationResult<AdminCancellationQueueDTO>>;
  readAdminCancellation(input: AdminCancellationInput): Promise<CancellationResult<AdminCancellationDetailDTO>>;
  decideCancellation(input: DecideCancellationServiceInput): Promise<CancellationResult<AdminCancellationDetailDTO>>;
}

export type SeatCancellationServiceDependencies = Readonly<{
  resolvePrincipal(token: string | null | undefined): Promise<import("./authorization.server.ts").ServerVerifiedPrincipal | null>;
  repository: SeatCancellationRepository;
}>;
