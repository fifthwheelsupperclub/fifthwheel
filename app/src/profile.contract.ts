/** Browser-safe member profile DTOs. Never put provider rows or credentials here. */

export type ProfileIdentity = "woman" | "man" | "non_binary";

export type MemberProfileDTO = Readonly<{
  profileRevision: number;
  firstName: string;
  lastName: string;
  dateOfBirth: string;
  identity: ProfileIdentity;
  openTo: readonly ProfileIdentity[];
  matchAgeMin: number;
  matchAgeMax: number;
  neighborhood: string;
  nights: readonly string[];
  lookingFor: "Casual" | "Open" | "Relationship";
  surpriseGame: "Yes, surprise me" | "I'd rather keep it conversational";
  phone: string | null;
  oneLiner: string | null;
}>;

export type W04ErrorCode = "unauthenticated" | "forbidden" | "not_found" | "invalid_input" | "conflict" | "temporarily_unavailable";

export type W04Error = Readonly<{
  code: W04ErrorCode;
  message: string;
  retryable: boolean;
  fields?: Readonly<Record<string, string>>;
  correlationId: string;
}>;

export type W04Response<T> =
  | Readonly<{ ok: true; data: T; correlationId: string }>
  | Readonly<{ ok: false; code: W04ErrorCode; message: string; retryable: boolean; correlationId: string; fields?: Readonly<Record<string, string>> }>;

export type MemberProfileSaveRequest = Readonly<{
  operationId: string;
  expectedProfileRevision: number;
  firstName: string;
  lastName: string;
  dateOfBirth: string;
  identity: ProfileIdentity;
  openTo: readonly ProfileIdentity[];
  matchAgeMin: number;
  matchAgeMax: number;
  neighborhood: string;
  nights: readonly string[];
  lookingFor: "Casual" | "Open" | "Relationship";
  surpriseGame: "Yes, surprise me" | "I'd rather keep it conversational";
  phone?: string | null;
  oneLiner?: string | null;
}>;
