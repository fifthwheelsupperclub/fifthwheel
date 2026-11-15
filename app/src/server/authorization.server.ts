/**
 * Server-side authorization decisions for route/service handlers.
 * Construct principals from a verified Auth identity plus trusted database reads;
 * never from request JSON, JWT user_metadata, or client-selected workspace roles.
 */

export type StaffRole = "admin" | "host" | "restaurant";
export type AdmissionState = "invited" | "activated" | "deleted" | "none";

export type ServerVerifiedPrincipal = Readonly<{
  userId: string;
  emailNormalized: string;
  emailVerified: boolean;
  /** Loaded from public.app_user_roles after Auth identity verification. */
  staffRoles: ReadonlySet<StaffRole>;
  /** Loaded by auth_user_id from app_admissions, never inferred from email alone. */
  admission: Readonly<{
    state: AdmissionState;
    authUserId: string | null;
    emailNormalized: string | null;
  }>;
  /** Loaded from trusted server-side assignment repositories on each authorization boundary. */
  assignedTableIds: ReadonlySet<string>;
  assignedVenueIds: ReadonlySet<string>;
}>;

export type AppPermission =
  | Readonly<{ workspace: "admin"; action: "waitlist:read" | "admission:invite" | "supply:read" | "supply:sync" | "supply:clone" | "roster:read" | "roster:approve" }>
  | Readonly<{ workspace: "member"; action: "member:read-own" | "member:edit-own" }>
  | Readonly<{ workspace: "host"; action: "table:operate" | "supply:draft" | "roster:read" | "roster:propose"; tableId: string }>
  | Readonly<{ workspace: "restaurant"; action: "venue:read-service"; venueId: string }>;

export type AuthorizationFailure =
  | "unauthenticated"
  | "email-unverified"
  | "member-not-admitted"
  | "forbidden"
  | "resource-not-assigned";

export type AuthorizationDecision =
  | Readonly<{ allowed: true; principal: ServerVerifiedPrincipal; permission: AppPermission }>
  | Readonly<{ allowed: false; reason: AuthorizationFailure }>;

function deny(reason: AuthorizationFailure): AuthorizationDecision {
  return { allowed: false, reason };
}

function normalizedEmail(value: string): string {
  return value.trim().toLowerCase();
}

function isAdmittedMember(principal: ServerVerifiedPrincipal): boolean {
  return principal.admission.state === "activated"
    && principal.admission.authUserId === principal.userId
    && principal.admission.emailNormalized !== null
    && normalizedEmail(principal.admission.emailNormalized) === normalizedEmail(principal.emailNormalized);
}

/**
 * Accepts only a server-assembled principal. Role and resource checks are repeated
 * here even when the request originated from a hidden navigation item.
 */
export function authorize(
  principal: ServerVerifiedPrincipal | null,
  permission: AppPermission,
): AuthorizationDecision {
  if (!principal) return deny("unauthenticated");
  if (!principal.emailVerified) return deny("email-unverified");

  switch (permission.workspace) {
    case "admin":
      return principal.staffRoles.has("admin")
        ? { allowed: true, principal, permission }
        : deny("forbidden");

    case "member":
      return isAdmittedMember(principal)
        ? { allowed: true, principal, permission }
        : deny("member-not-admitted");

    case "host":
      if (!principal.staffRoles.has("host")) return deny("forbidden");
      return principal.assignedTableIds.has(permission.tableId)
        ? { allowed: true, principal, permission }
        : deny("resource-not-assigned");

    case "restaurant":
      if (!principal.staffRoles.has("restaurant")) return deny("forbidden");
      return principal.assignedVenueIds.has(permission.venueId)
        ? { allowed: true, principal, permission }
        : deny("resource-not-assigned");

    default: {
      const exhaustive: never = permission;
      return exhaustive;
    }
  }
}
