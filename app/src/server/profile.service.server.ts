/** Authorized member profile read and save. */

import {
  authorize,
  type AppPermission,
  type ServerVerifiedPrincipal,
} from "./authorization.server.ts";
import { ProfileRepositoryError } from "./profile.contract.server.ts";
import type {
  ProfileErrorCode,
  ProfileServiceDependencies,
  ProfileServicePort,
  ProfileServiceResult,
  StoredProfile,
} from "./profile.contract.server.ts";
import type { MemberProfileDTO } from "../profile.contract.ts";

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const neighborhoods = new Set(["Inman Park", "Chamblee", "Virginia Highlands"]);
const weekdays = new Set(["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"]);

function fail<T>(code: ProfileErrorCode, correlationId: string, fields?: Record<string, string>): ProfileServiceResult<T> {
  const messageByCode: Record<ProfileErrorCode, string> = {
    unauthenticated: "Sign in to continue.",
    forbidden: "You do not have access to this profile action.",
    not_found: "The requested profile information is unavailable.",
    invalid_input: "Check the highlighted fields and try again.",
    conflict: "This profile changed. Refresh it and try again.",
    temporarily_unavailable: "This profile action is temporarily unavailable. Try again shortly.",
  };
  return {
    ok: false,
    code,
    message: messageByCode[code],
    retryable: code === "conflict" || code === "temporarily_unavailable",
    correlationId,
    ...(fields ? { fields } : {}),
  };
}

function mapError(error: unknown): ProfileErrorCode {
  if (error instanceof ProfileRepositoryError) {
    switch (error.code) {
      case "not_found": return "not_found";
      case "forbidden": return "forbidden";
      case "conflict": return "conflict";
      case "invalid_input": return "invalid_input";
      default: return "temporarily_unavailable";
    }
  }
  return "temporarily_unavailable";
}

function authorized(
  principal: ServerVerifiedPrincipal | null,
  permission: AppPermission,
): principal is ServerVerifiedPrincipal {
  return authorize(principal, permission).allowed;
}

function memberDTO(profile: StoredProfile): MemberProfileDTO {
  return Object.freeze({
    profileRevision: profile.profileRevision,
    firstName: profile.firstName,
    lastName: profile.lastName,
    dateOfBirth: profile.dateOfBirth,
    identity: profile.identity,
    openTo: [...profile.openTo],
    matchAgeMin: profile.matchAgeMin,
    matchAgeMax: profile.matchAgeMax,
    neighborhood: profile.neighborhood,
    nights: [...profile.nights],
    lookingFor: profile.lookingFor,
    surpriseGame: profile.surpriseGame,
    phone: profile.phone,
    oneLiner: profile.oneLiner,
  });
}

function validRevision(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) > 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function validDate(value: string): { year: number; month: number; day: number } | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return null;
  const [year, month, day] = match.slice(1).map(Number);
  const date = new Date(0);
  date.setUTCHours(0, 0, 0, 0);
  date.setUTCFullYear(year!, month! - 1, day!);
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month! - 1 || date.getUTCDate() !== day) return null;
  return { year: year!, month: month!, day: day! };
}

function validateProfileSave(value: unknown, now: Date): Record<string, string> | null {
  const fields: Record<string, string> = {};
  if (!isRecord(value)) return { form: "Submit a valid profile." };
  const input = value;
  if (typeof input.operationId !== "string" || !uuidPattern.test(input.operationId)) fields.operationId = "Refresh and try again.";
  if (!validRevision(input.expectedProfileRevision)) fields.expectedProfileRevision = "Refresh and try again.";
  if (typeof input.firstName !== "string" || !input.firstName.trim() || input.firstName.length > 100) fields.firstName = "Add a valid first name.";
  if (typeof input.lastName !== "string" || !input.lastName.trim() || input.lastName.length > 100) fields.lastName = "Add a valid last name.";
  const birth = typeof input.dateOfBirth === "string" ? validDate(input.dateOfBirth) : null;
  if (!birth) fields.dateOfBirth = "Enter a valid date of birth.";
  else {
    const parts = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(now);
    const part = (name: string) => Number(parts.find((entry) => entry.type === name)?.value);
    const year = part("year"); const month = part("month"); const day = part("day");
    const age = year - birth.year - (month < birth.month || (month === birth.month && day < birth.day) ? 1 : 0);
    if (age < 21) fields.dateOfBirth = "You must be 21 or older.";
  }
  const identities = new Set(["woman", "man", "non_binary"]);
  if (typeof input.identity !== "string" || !identities.has(input.identity)) fields.identity = "Choose a valid identity.";
  if (!Array.isArray(input.openTo) || input.openTo.length < 1 || input.openTo.length > 3
      || input.openTo.some((option) => typeof option !== "string" || !identities.has(option))
      || new Set(input.openTo).size !== input.openTo.length) fields.openTo = "Choose one or more valid options.";
  const minAge = input.matchAgeMin;
  const maxAge = input.matchAgeMax;
  if (typeof minAge !== "number" || !Number.isInteger(minAge) || minAge < 21 || minAge > 120) fields.matchAgeMin = "Enter an age from 21 to 120.";
  if (typeof maxAge !== "number" || !Number.isInteger(maxAge) || maxAge < 21 || maxAge > 120
      || (typeof minAge === "number" && maxAge < minAge)) fields.matchAgeMax = "Enter a valid maximum from 21 to 120.";
  if (typeof input.neighborhood !== "string" || !neighborhoods.has(input.neighborhood)) fields.neighborhood = "Choose a valid neighborhood.";
  if (!Array.isArray(input.nights) || input.nights.length > 7 || input.nights.some((day) => typeof day !== "string" || !weekdays.has(day))
      || new Set(input.nights).size !== input.nights.length) fields.nights = "Choose valid days.";
  if (typeof input.lookingFor !== "string" || !["Casual", "Open", "Relationship"].includes(input.lookingFor)) fields.lookingFor = "Choose what you are looking for.";
  if (typeof input.surpriseGame !== "string" || !["Yes, surprise me", "I'd rather keep it conversational"].includes(input.surpriseGame)) fields.surpriseGame = "Choose a valid option.";
  if (input.phone !== undefined && input.phone !== null && (typeof input.phone !== "string" || input.phone.length > 40)) fields.phone = "Phone must be 40 characters or fewer.";
  if (input.oneLiner !== undefined && input.oneLiner !== null && (typeof input.oneLiner !== "string" || input.oneLiner.length > 1000)) fields.oneLiner = "Keep this to 1,000 characters or fewer.";
  return Object.keys(fields).length ? fields : null;
}

export function createProfileService(dependencies: ProfileServiceDependencies): ProfileServicePort {
  const { resolvePrincipal, repository, createId, now } = dependencies;

  async function getPrincipal(accessToken: string | null | undefined): Promise<ServerVerifiedPrincipal | null | undefined> {
    try {
      return await resolvePrincipal(accessToken);
    } catch {
      // A verifier outage is not an invalid session. Preserve the distinction
      // so the UI can retry instead of signing the member out.
      return undefined;
    }
  }

  const service: ProfileServicePort = {
    async readMemberProfile(accessToken) {
      const correlationId = createId();
      const principal = await getPrincipal(accessToken);
      if (principal === undefined) return fail("temporarily_unavailable", correlationId);
      if (!principal) return fail("unauthenticated", correlationId);
      if (!authorized(principal, { workspace: "member", action: "member:read-own" })) return fail("forbidden", correlationId);
      try {
        return { ok: true, data: memberDTO(await repository.ensureProfile(principal.userId)), correlationId };
      } catch (error) {
        return fail(mapError(error), correlationId);
      }
    },

    async saveMemberProfile(accessToken, request) {
      const correlationId = createId();
      const principal = await getPrincipal(accessToken);
      if (principal === undefined) return fail("temporarily_unavailable", correlationId);
      if (!principal) return fail("unauthenticated", correlationId);
      if (!authorized(principal, { workspace: "member", action: "member:edit-own" })) return fail("forbidden", correlationId);
      const fields = validateProfileSave(request, now());
      if (fields) return fail("invalid_input", correlationId, fields);
      try {
        const profile = await repository.saveProfile({
          authUserId: principal.userId,
          operationId: request.operationId,
          expectedProfileRevision: request.expectedProfileRevision,
          fields: request as unknown as Record<string, unknown>,
        });
        return { ok: true, data: memberDTO(profile), correlationId };
      } catch (error) {
        return fail(mapError(error), correlationId);
      }
    },
  };
  return Object.freeze(service);
}
