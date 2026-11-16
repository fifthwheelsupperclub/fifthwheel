/** Server-only persistence contracts for member profiles. */

import type { MemberProfileDTO, MemberProfileSaveRequest } from "../profile.contract.ts";
import type { ServerVerifiedPrincipal } from "./authorization.server.ts";

export type ProfileErrorCode =
  | "unauthenticated"
  | "forbidden"
  | "not_found"
  | "invalid_input"
  | "conflict"
  | "temporarily_unavailable";

export class ProfileRepositoryError extends Error {
  readonly code: "configuration_invalid" | "repository_unavailable" | "not_found" | "conflict" | "forbidden" | "invalid_data" | "invalid_input";

  constructor(code: ProfileRepositoryError["code"]) {
    super(code);
    this.name = "ProfileRepositoryError";
    this.code = code;
  }
}

export type ProfileServiceResult<T> =
  | Readonly<{ ok: true; data: T; correlationId: string }>
  | Readonly<{
      ok: false;
      code: ProfileErrorCode;
      message: string;
      retryable: boolean;
      correlationId: string;
      fields?: Readonly<Record<string, string>>;
    }>;

export type StoredProfile = Readonly<{
  guestId: string;
  authUserId: string;
  admissionId: string;
  profileRevision: number;
  firstName: string;
  lastName: string;
  dateOfBirth: string;
  identity: MemberProfileDTO["identity"];
  openTo: readonly MemberProfileDTO["identity"][];
  matchAgeMin: number;
  matchAgeMax: number;
  neighborhood: string;
  nights: readonly string[];
  lookingFor: MemberProfileDTO["lookingFor"];
  surpriseGame: MemberProfileDTO["surpriseGame"];
  phone: string | null;
  oneLiner: string | null;
  updatedAt: string;
}>;

export type ProfileRepository = Readonly<{
  ensureProfile(authUserId: string): Promise<StoredProfile>;
  saveProfile(input: Readonly<{ authUserId: string; operationId: string; expectedProfileRevision: number; fields: Record<string, unknown> }>): Promise<StoredProfile>;
}>;

export type ProfileServiceDependencies = Readonly<{
  resolvePrincipal(accessToken: string | null | undefined): Promise<ServerVerifiedPrincipal | null>;
  repository: ProfileRepository;
  createId(): string;
  now(): Date;
}>;

export type ProfileServicePort = Readonly<{
  readMemberProfile(accessToken: string | null | undefined): Promise<ProfileServiceResult<MemberProfileDTO>>;
  saveMemberProfile(accessToken: string | null | undefined, request: MemberProfileSaveRequest): Promise<ProfileServiceResult<MemberProfileDTO>>;
}>;
