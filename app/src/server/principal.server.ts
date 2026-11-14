/** Server-only composition of verified Auth identity and trusted authorization facts. */

import type { VerifiedAuthIdentity } from "./admission.contracts.server.ts";
import type { ServerVerifiedPrincipal } from "./authorization.server.ts";
import type { SupabaseServerClient } from "./supabase.server.ts";

export type TrustedResourceAssignments = Readonly<{
  tableIds: readonly string[];
  venueIds: readonly string[];
}>;

/** Implement only from trusted assignment tables/RPCs; never from request or user metadata. */
export interface TrustedAssignmentReader {
  readForAuthUser(authUserId: string): Promise<TrustedResourceAssignments>;
}

/** Until W08 owns assignment tables, staff resource access is always denied. */
export const noResourceAssignments: TrustedAssignmentReader = Object.freeze({
  async readForAuthUser() {
    return { tableIds: [], venueIds: [] };
  },
});

export type VerifiedPrincipalResolver = (accessToken: string | null | undefined) => Promise<ServerVerifiedPrincipal | null>;

export class PrincipalAssemblyError extends Error {
  readonly code: "trusted_assignments_unavailable" | "trusted_assignments_invalid";

  constructor(code: "trusted_assignments_unavailable" | "trusted_assignments_invalid") {
    super(code);
    this.name = "PrincipalAssemblyError";
    this.code = code;
  }
}

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function validateAssignments(assignments: TrustedResourceAssignments): TrustedResourceAssignments {
  if (
    !assignments
    || !Array.isArray(assignments.tableIds)
    || !Array.isArray(assignments.venueIds)
    || [...assignments.tableIds, ...assignments.venueIds].some((id) => typeof id !== "string" || !uuidPattern.test(id))
  ) {
    throw new PrincipalAssemblyError("trusted_assignments_invalid");
  }
  return assignments;
}

export function createVerifiedPrincipalResolver(
  supabase: SupabaseServerClient,
  assignmentReader: TrustedAssignmentReader = noResourceAssignments,
): VerifiedPrincipalResolver {
  return async (accessToken) => {
    if (typeof accessToken !== "string" || accessToken.trim().length === 0) return null;
    const identity: VerifiedAuthIdentity | null = await supabase.verifyAccessToken(accessToken);
    // Do not spend service-role access on an Auth identity that cannot enter
    // any protected workspace. Verification is a prerequisite to trusted reads.
    if (!identity || !identity.emailVerified) return null;

    const [facts, rawAssignments] = await Promise.all([
      supabase.readTrustedAuthorizationFacts(identity.authUserId),
      assignmentReader.readForAuthUser(identity.authUserId).catch(() => {
        throw new PrincipalAssemblyError("trusted_assignments_unavailable");
      }),
    ]);
    const assignments = validateAssignments(rawAssignments);

    return Object.freeze({
      userId: identity.authUserId,
      emailNormalized: identity.emailNormalized,
      emailVerified: identity.emailVerified,
      staffRoles: new Set(facts.staffRoles),
      admission: facts.admission,
      assignedTableIds: new Set(assignments.tableIds),
      assignedVenueIds: new Set(assignments.venueIds),
    });
  };
}
