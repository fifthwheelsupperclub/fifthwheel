/** Server-only app-link request and explicit callback confirmation services. */

import type {
  AdmissionRepository,
  AuthLinkProvider,
  ReturningLinkRequestRepository,
  ServiceError,
  ServiceResult,
  VerifiedAuthIdentity,
} from "./admission.contracts.server.ts";

export type AuthServiceDependencies = Readonly<{
  admissionRepository: Pick<AdmissionRepository, "findActiveAdmissionByEmail" | "activateFromVerifiedIdentity">;
  linkRequestRepository: Pick<ReturningLinkRequestRepository, "claimRecipientCooldown">;
  authProvider: AuthLinkProvider;
  /** Validates any existing app session cookie without trusting its claims. */
  verifyExistingAccessToken(accessToken: string): Promise<VerifiedAuthIdentity | null>;
  sendLink(input: Readonly<{ recipientEmail: string; actionLink: string; kind: "invite" | "magiclink" }>): Promise<Readonly<{ state: "accepted" | "unknown" | "failed" }>>;
  appOrigin: string;
  now?: () => Date;
  /** Minimum generic-response duration; set to zero only in deterministic unit tests. */
  minimumRequestResponseMs?: number;
}>;

export type AuthService = Readonly<{
  requestLink(input: Readonly<{ email: string; safeReturnTo?: string }>): Promise<ServiceResult<Readonly<{ accepted: true }>>>;
  /** Server-only result: HTTP adapters must set cookies and strip session tokens from JSON. */
  verifyLink(input: Readonly<{ tokenHash: string; kind: "invite" | "magiclink"; safeReturnTo?: string; existingAccessToken?: string | null }>): Promise<ServiceResult<Readonly<{ nextPath: string; authUserId: string; admissionId: string; firstActivation: boolean; session: Readonly<{ accessToken: string; refreshToken: string }> }>>>;
}>;

const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const tokenPattern = /^[A-Za-z0-9_-]{16,512}$/;

function resultError(code: ServiceError["code"], safeMessage: string): ServiceResult<never> {
  return { ok: false, error: { code, safeMessage } };
}

function normalizeEmail(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const email = value.trim().toLowerCase();
  return email.length <= 320 && emailPattern.test(email) ? email : null;
}

function safeNextPath(value: unknown, appOrigin: string): string {
  if (typeof value !== "string" || value.length > 2048 || !value.startsWith("/") || value.startsWith("//") || /[\\\u0000-\u001f\u007f]/.test(value)) return "/member";
  try {
    const parsed = new URL(value, appOrigin);
    const origin = new URL(appOrigin).origin;
    return parsed.origin === origin ? `${parsed.pathname}${parsed.search}` : "/member";
  } catch {
    return "/member";
  }
}

function validAppOrigin(value: string): boolean {
  try {
    const parsed = new URL(value);
    return parsed.origin === value && parsed.pathname === "/" && !parsed.search && !parsed.hash && !parsed.username && !parsed.password;
  } catch { return false; }
}

export function createAuthService(dependencies: AuthServiceDependencies): AuthService {
  if (!validAppOrigin(dependencies.appOrigin)) throw new TypeError("auth_service_configuration_invalid");
  const now = dependencies.now ?? (() => new Date());
  const minimumRequestResponseMs = dependencies.minimumRequestResponseMs ?? 1_000;
  if (!Number.isInteger(minimumRequestResponseMs) || minimumRequestResponseMs < 0 || minimumRequestResponseMs > 5_000) throw new TypeError("auth_service_configuration_invalid");
  const callback = new URL("/auth/callback", dependencies.appOrigin).href;

  return Object.freeze({
    async requestLink(input) {
      const startedAt = performance.now();
      const email = normalizeEmail(input.email);
      // This endpoint is deliberately indistinguishable for invalid, unknown,
      // admitted, throttled, and provider-failure cases.
      if (email) {
        try {
          const admission = await dependencies.admissionRepository.findActiveAdmissionByEmail(email);
          if (admission && admission.state === "activated" && admission.email_normalized === email) {
            const allowed = await dependencies.linkRequestRepository.claimRecipientCooldown({
              admissionId: admission.id,
              requestedAt: now().toISOString(),
              cooldownSeconds: 300,
            });
            if (allowed) {
              const link = await dependencies.authProvider.createMagicLink({ emailNormalized: email, redirectTo: callback, kind: "magiclink", safeReturnTo: safeNextPath(input.safeReturnTo, dependencies.appOrigin) });
              await dependencies.sendLink({ recipientEmail: email, actionLink: link.actionLink, kind: "magiclink" });
            }
          }
        } catch {
          // Generic acceptance is intentional; failures remain observable only
          // through bounded server-side metrics, never an account oracle.
        }
      }
      // Reduce the account-state timing signal for the common local provider
      // path. Production still needs timing-shape measurement against bounded
      // provider and database deadlines; this fixed floor is not a queue.
      const remaining = minimumRequestResponseMs - (performance.now() - startedAt);
      if (remaining > 0) await new Promise<void>((resolve) => setTimeout(resolve, remaining));
      return { ok: true, value: { accepted: true } };
    },

    async verifyLink(input) {
      if (!tokenPattern.test(input.tokenHash) || !["invite", "magiclink"].includes(input.kind)) {
        return resultError("invalid_link", "This sign-in link is invalid or has expired.");
      }
      let currentIdentity: VerifiedAuthIdentity | null = null;
      if (typeof input.existingAccessToken === "string" && input.existingAccessToken.length > 0) {
        try {
          // Check the current session before exchanging the one-time link token.
          // If Auth is unavailable, the link remains unconsumed for recovery.
          currentIdentity = await dependencies.verifyExistingAccessToken(input.existingAccessToken);
        } catch {
          return resultError("temporarily_unavailable", "Your current sign-in could not be checked. Keep this page open and try again.");
        }
        if (currentIdentity) {
          // Do not consume a single-use recipient link while any app identity is
          // active. The browser can sign out, then reopen the same intercepted
          // link; this also avoids an unnecessary same-user session rotation.
          return resultError("conflict", "You are already signed in. Sign out first, then reopen this same link. Your current session was kept.");
        }
      }
      let verified: Awaited<ReturnType<AuthLinkProvider["verifyCallback"]>>;
      try {
        verified = await dependencies.authProvider.verifyCallback({ tokenHash: input.tokenHash, kind: input.kind });
      } catch {
        return resultError("invalid_link", "This sign-in link is invalid or has expired.");
      }
      const identity: VerifiedAuthIdentity = verified.identity;
      if (!identity.emailVerified || !emailPattern.test(identity.emailNormalized) || identity.emailNormalized !== identity.emailNormalized.trim().toLowerCase()) {
        return resultError("invalid_link", "This sign-in link is invalid or has expired.");
      }
      try {
        const activated = await dependencies.admissionRepository.activateFromVerifiedIdentity({
          authUserId: identity.authUserId,
          emailNormalized: identity.emailNormalized,
          activatedAt: now().toISOString(),
        });
        if ((activated.kind !== "activated" && activated.kind !== "already_active") || !activated.admission) {
          return resultError("invalid_link", "This sign-in link is invalid or has expired.");
        }
        return {
          ok: true,
          value: {
            nextPath: safeNextPath(input.safeReturnTo, dependencies.appOrigin),
            authUserId: identity.authUserId,
            admissionId: activated.admission.id,
            firstActivation: activated.kind === "activated",
            session: verified.session,
          },
        };
      } catch {
        return resultError("temporarily_unavailable", "Sign-in could not be completed. Request a new link and try again.");
      }
    },
  });
}
