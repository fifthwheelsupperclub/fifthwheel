/** Resolve only workspaces granted by the verified server principal. */

import { authorize, type ServerVerifiedPrincipal } from "./authorization.server.ts";
import type { VerifiedPrincipalResolver } from "./principal.server.ts";
import { getAccessTokenForPrincipal } from "./session.cookies.server.ts";

export type WorkspaceKey = "member" | "admin" | "host" | "restaurant";
export type AuthorizedWorkspace = Readonly<{ key: WorkspaceKey; available: boolean }>;

export function authorizedWorkspaces(principal: ServerVerifiedPrincipal): readonly AuthorizedWorkspace[] {
  const workspaces: AuthorizedWorkspace[] = [];
  if (authorize(principal, { workspace: "member", action: "member:read-own" }).allowed) {
    workspaces.push({ key: "member", available: true });
  }
  if (authorize(principal, { workspace: "admin", action: "waitlist:read" }).allowed) {
    workspaces.push({ key: "admin", available: true });
  }
  const hasAssignedRosterTable = [...principal.assignedTableIds].some((tableId) =>
    authorize(principal, { workspace: "host", action: "roster:read", tableId }).allowed);
  if (hasAssignedRosterTable) {
    workspaces.push({ key: "host", available: true });
  }
  if (principal.staffRoles.has("restaurant") && principal.assignedVenueIds.size > 0) {
    workspaces.push({ key: "restaurant", available: true });
  }
  return Object.freeze(workspaces);
}

export function createWorkspacesGetHandler(resolvePrincipal: VerifiedPrincipalResolver) {
  return async (request: Request): Promise<Response> => {
    const token = getAccessTokenForPrincipal(request);
    const headers = { "cache-control": "no-store", vary: "Cookie" };
    if (!token) return Response.json({ error: { code: "unauthenticated", message: "Sign in to continue." } }, { status: 401, headers });
    try {
      const principal = await resolvePrincipal(token);
      if (!principal) return Response.json({ error: { code: "unauthenticated", message: "Sign in to continue." } }, { status: 401, headers });
      const workspaces = authorizedWorkspaces(principal);
      if (workspaces.length === 0) return Response.json({ error: { code: "forbidden", message: "No workspace is available for this account." } }, { status: 403, headers });
      return Response.json({ workspaces }, { status: 200, headers });
    } catch {
      return Response.json({ error: { code: "temporarily_unavailable", message: "Your workspaces are temporarily unavailable." } }, { status: 503, headers });
    }
  };
}
