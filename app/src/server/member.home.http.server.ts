/** Cookie-authenticated, verified-principal read for the limited member-home milestone. */

import { authorize, type ServerVerifiedPrincipal } from "./authorization.server.ts";
import type { VerifiedPrincipalResolver } from "./principal.server.ts";
import { getAccessTokenForPrincipal } from "./session.cookies.server.ts";

export function createMemberHomeGetHandler(resolvePrincipal: VerifiedPrincipalResolver) {
  return async (request: Request): Promise<Response> => {
    const accessToken = getAccessTokenForPrincipal(request);
    const headers = { "cache-control": "no-store", vary: "Cookie" };
    if (!accessToken) {
      return Response.json({ error: { code: "unauthenticated", message: "Sign in to continue." } }, { status: 401, headers });
    }

    let principal: ServerVerifiedPrincipal | null;
    try {
      principal = await resolvePrincipal(accessToken);
    } catch {
      return Response.json({ error: { code: "temporarily_unavailable", message: "Your member home is temporarily unavailable." } }, { status: 503, headers });
    }
    const decision = authorize(principal, { workspace: "member", action: "member:read-own" });
    if (!decision.allowed) {
      const unauthenticated = decision.reason === "unauthenticated" || decision.reason === "email-unverified";
      return Response.json({
        error: {
          code: unauthenticated ? "unauthenticated" : "forbidden",
          message: unauthenticated ? "Sign in to continue." : "Member access is not active for this account.",
        },
      }, { status: unauthenticated ? 401 : 403, headers });
    }

    // This milestone reads only verified identity/admission. It deliberately does
    // not invent profile, Table, request, invitation, payment, or Seat records.
    return Response.json({
      member: {
        email: decision.principal.emailNormalized,
        admissionState: decision.principal.admission.state,
      },
    }, { status: 200, headers });
  };
}
