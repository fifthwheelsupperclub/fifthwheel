/** Server-only admin services for waitlist review and app admission. */

import type {
  AdmissionRepository,
  AdmissionDeliveryOperation,
  ServiceError,
  ServiceResult,
  WaitlistRepository,
  WaitlistReviewItem,
} from "./admission.contracts.server.ts";
import { authorize } from "./authorization.server.ts";
import type { VerifiedPrincipalResolver } from "./principal.server.ts";
import { AdmissionRepositoryError } from "./admission.repository.server.ts";
import { WaitlistSearchRepositoryError } from "./waitlist.search.repository.server.ts";

export type AdminWaitlistSearchInput = Readonly<{
  accessToken?: string | null;
  query?: string;
  neighborhood?: string;
  cursor?: string;
  limit: number;
}>;

/** The actor is intentionally absent; it always comes from the verified principal. */
export type AdminAdmitWaitlistInput = Readonly<{
  accessToken?: string | null;
  signupId: string;
  operationId: string;
}>;

export type AdminWaitlistListItem = Readonly<{
  id: string;
  firstName: string;
  lastName: string;
  emailNormalized: string;
  neighborhood: string;
  identity: WaitlistReviewItem["identity"];
  openTo: readonly WaitlistReviewItem["openTo"][number][];
  receivedAt: string;
  admissionState: WaitlistReviewItem["admissionState"];
  latestDelivery: WaitlistReviewItem["latestDelivery"];
}>;

export type AdminWaitlistSearchResult = Readonly<{
  items: readonly AdminWaitlistListItem[];
  nextCursor: string | null;
}>;

/** Safe response; contains operation identifiers and states, never recipient PII or DB rows. */
export type AdminAdmitWaitlistResult = Readonly<{
  signupId: string;
  admissionId: string;
  admissionState: "invited";
  deliveryId: string;
  operationId: string;
  deliveryState: AdmissionDeliveryOperation["delivery"]["state"];
  created: boolean;
}>;

export type AdmissionServiceDependencies = Readonly<{
  resolvePrincipal: VerifiedPrincipalResolver;
  waitlistRepository: Pick<WaitlistRepository, "search">;
  admissionRepository: Pick<AdmissionRepository, "admitAndQueueInvitation">;
}>;

export interface AdmissionService {
  searchWaitlist(input: AdminWaitlistSearchInput): Promise<ServiceResult<AdminWaitlistSearchResult>>;
  admitWaitlistMember(input: AdminAdmitWaitlistInput): Promise<ServiceResult<AdminAdmitWaitlistResult>>;
}

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function failure(code: ServiceError["code"], safeMessage: string): ServiceResult<never> {
  return { ok: false, error: { code, safeMessage } };
}

function mapSearchError(error: unknown): ServiceResult<never> {
  if (error instanceof WaitlistSearchRepositoryError && error.code === "validation_failed") {
    return failure("validation_failed", "Check the search filters and try again.");
  }
  return failure("temporarily_unavailable", "Waitlist search is temporarily unavailable.");
}

function mapAdmissionError(error: unknown): ServiceResult<never> {
  if (!(error instanceof AdmissionRepositoryError)) {
    return failure("temporarily_unavailable", "The invitation could not be queued. Try again with the same operation ID.");
  }
  switch (error.code) {
    case "validation_failed":
      return failure("validation_failed", "Check the signup and operation identifiers.");
    case "forbidden":
      return failure("forbidden", "You are not allowed to admit this waitlist member.");
    case "not_found":
      return failure("not_found", "The waitlist signup could not be found.");
    case "conflict":
      return failure("conflict", "The admission or operation conflicts with the current state.");
    case "provider_outcome_unknown":
      return failure("provider_outcome_unknown", "The invitation queue outcome is unknown. Retry with the same operation ID.");
    case "configuration_invalid":
    case "provider_failed":
    case "provider_data_invalid":
      return failure("temporarily_unavailable", "The invitation could not be queued. Try again later.");
  }
}

function toListItem(item: WaitlistReviewItem): AdminWaitlistListItem {
  return Object.freeze({
    id: item.id,
    firstName: item.firstName,
    lastName: item.lastName,
    emailNormalized: item.emailNormalized,
    neighborhood: item.neighborhood,
    identity: item.identity,
    openTo: [...item.openTo],
    receivedAt: item.receivedAt,
    admissionState: item.admissionState,
    latestDelivery: item.latestDelivery ? { ...item.latestDelivery } : null,
  });
}

function toAdmissionResult(
  signupId: string,
  operationId: string,
  result: AdmissionDeliveryOperation,
): AdminAdmitWaitlistResult {
  return Object.freeze({
    signupId,
    admissionId: result.admission.id,
    admissionState: "invited",
    deliveryId: result.delivery.id,
    operationId,
    deliveryState: result.delivery.state,
    created: result.created,
  });
}

export function createAdmissionService(dependencies: AdmissionServiceDependencies): AdmissionService {
  return Object.freeze({
    async searchWaitlist(input: AdminWaitlistSearchInput): Promise<ServiceResult<AdminWaitlistSearchResult>> {
      let principal;
      try {
        principal = await dependencies.resolvePrincipal(input.accessToken);
      } catch {
        return failure("temporarily_unavailable", "Your access could not be verified. Try again.");
      }
      const decision = authorize(principal, { workspace: "admin", action: "waitlist:read" });
      if (!decision.allowed) {
        return failure(
          decision.reason === "unauthenticated" || decision.reason === "email-unverified" ? "unauthenticated" : "forbidden",
          "You are not allowed to view the waitlist.",
        );
      }

      try {
        const page = await dependencies.waitlistRepository.search({
          query: input.query,
          neighborhood: input.neighborhood,
          cursor: input.cursor,
          limit: input.limit,
        });
        return {
          ok: true,
          value: {
            items: page.rows.map(toListItem),
            nextCursor: page.nextCursor,
          },
        };
      } catch (error) {
        return mapSearchError(error);
      }
    },

    async admitWaitlistMember(input: AdminAdmitWaitlistInput): Promise<ServiceResult<AdminAdmitWaitlistResult>> {
      let principal;
      try {
        principal = await dependencies.resolvePrincipal(input.accessToken);
      } catch {
        return failure("temporarily_unavailable", "Your access could not be verified. Try again.");
      }
      const decision = authorize(principal, { workspace: "admin", action: "admission:invite" });
      if (!decision.allowed) {
        return failure(
          decision.reason === "unauthenticated" || decision.reason === "email-unverified" ? "unauthenticated" : "forbidden",
          "You are not allowed to admit this waitlist member.",
        );
      }
      if (!uuidPattern.test(input.signupId) || !uuidPattern.test(input.operationId)) {
        return failure("validation_failed", "Check the signup and operation identifiers.");
      }

      try {
        const result = await dependencies.admissionRepository.admitAndQueueInvitation({
          signupId: input.signupId,
          operationId: input.operationId,
          approvedByUserId: decision.principal.userId,
        });
        return { ok: true, value: toAdmissionResult(input.signupId, input.operationId, result) };
      } catch (error) {
        return mapAdmissionError(error);
      }
    },
  });
}
