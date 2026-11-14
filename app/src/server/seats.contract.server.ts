/** W07.3 owner-authorized, read-only Seat service contracts. */

import type {
  MemberPendingCheckoutDTO, MemberSeatDetailDTO, MemberSeatErrorCode, MemberSeatListDTO,
  MemberSeatResponse, SeatStatusReaderResult,
} from "../seats.contract.ts";

export type SeatReadFailure = Readonly<{
  code: MemberSeatErrorCode;
  safeMessage: string;
  retryable: boolean;
}>;
export type SeatReadResult<T> =
  | Readonly<{ ok: true; value: T }>
  | Readonly<{ ok: false; error: SeatReadFailure }>;

export type SeatReadInput = Readonly<{ accessToken?: string | null }>;
export type SeatListInput = SeatReadInput & Readonly<{ cursor?: string | null; limit?: number }>;
export type SeatDetailInput = SeatReadInput & Readonly<{ seatId: string }>;
export type InvitationSeatStatusInput = Readonly<{ invitationId: string }>;

export interface SeatRepository {
  listMySeats(actorUserId: string, cursor: Readonly<{ createdAt: string; seatId: string }> | null, limit: number): Promise<MemberSeatListDTO>;
  readMySeat(actorUserId: string, seatId: string): Promise<MemberSeatDetailDTO>;
  readInvitationSeatStatus(invitationId: string): Promise<SeatStatusReaderResult>;
}

export interface SeatService {
  list(input: SeatListInput): Promise<SeatReadResult<MemberSeatListDTO>>;
  read(input: SeatDetailInput): Promise<SeatReadResult<MemberSeatDetailDTO>>;
  calendar(input: SeatDetailInput): Promise<SeatReadResult<string>>;
  readInvitationSeatStatus(input: InvitationSeatStatusInput): Promise<SeatStatusReaderResult>;
}

export type SeatServiceDependencies = Readonly<{
  resolvePrincipal(token: string | null | undefined): Promise<import("./authorization.server.ts").ServerVerifiedPrincipal | null>;
  repository: SeatRepository;
  now?: () => number;
}>;

export type SeatReadEnvelope<T> = MemberSeatResponse<T>;
export type PendingCheckoutDTO = MemberPendingCheckoutDTO;
