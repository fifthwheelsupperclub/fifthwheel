/** Server-only admin-triggered app-invitation delivery operation. */

import type { AdmissionEmailProvider, AuthLinkProvider, DeliveryAttemptState } from "./admission.contracts.server.ts";
import { authorize } from "./authorization.server.ts";
import type { VerifiedPrincipalResolver } from "./principal.server.ts";
import { SupabaseAuthLinkError } from "./auth.link.supabase.server.ts";

export type InvitationDeliveryContext = Readonly<{
  deliveryId: string;
  admissionId: string;
  signupId: string;
  recipientEmail: string;
  admissionState: "invited" | "activated" | "deleted";
}>;

export type InvitationDeliveryServiceDependencies = Readonly<{
  resolvePrincipal: VerifiedPrincipalResolver;
  getContext(deliveryId: string): Promise<InvitationDeliveryContext | null>;
  beginAttempt(input: Readonly<{ deliveryId: string; operationId: string; startedByUserId: string }>): Promise<Readonly<{ delivery: { id: string; state: string }; attempt: { id: string }; created: boolean }> | null>;
  finishAttempt(input: Readonly<{ attemptId: string; state: Exclude<DeliveryAttemptState, "sending">; providerMessageId?: string; safeErrorCode?: string; finishedAt: string }>): Promise<void>;
  getLatestAttempt(deliveryId: string): Promise<Readonly<{ id: string; state: string; provider_message_id: string | null }> | null>;
  reconcileAttempt(input: Readonly<{ attemptId: string; state: "accepted" | "failed" | "unknown"; providerMessageId?: string; resolvedAt: string }>): Promise<void>;
  authProvider: AuthLinkProvider;
  emailProvider: AdmissionEmailProvider;
  appOrigin: string;
  now?: () => Date;
  createOperationId?: () => string;
}>;

export type InvitationDeliveryService = Readonly<{
  send(input: Readonly<{ accessToken?: string | null; deliveryId: string; operationId?: string }>): Promise<Readonly<{
    ok: true; value: Readonly<{ deliveryId: string; attemptId: string; state: "accepted" | "failed" | "unknown"; safeMessage: string }>;
  }> | Readonly<{ ok: false; error: Readonly<{ code: string; safeMessage: string }> }>>;
  reconcile(input: Readonly<{ accessToken?: string | null; deliveryId: string }>): Promise<Readonly<{
    ok: true; value: Readonly<{ deliveryId: string; attemptId: string; state: "accepted" | "failed" | "unknown"; safeMessage: string }>;
  }> | Readonly<{ ok: false; error: Readonly<{ code: string; safeMessage: string }> }>>;
}>;

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function fail(code: string, safeMessage: string) {
  return { ok: false as const, error: { code, safeMessage } };
}

export function createInvitationDeliveryService(dependencies: InvitationDeliveryServiceDependencies): InvitationDeliveryService {
  const now = dependencies.now ?? (() => new Date());
  const createOperationId = dependencies.createOperationId ?? (() => crypto.randomUUID());
  const redirectTo = new URL("/auth/callback", dependencies.appOrigin).href;

  return Object.freeze({
    async send(input) {
      let principal;
      try { principal = await dependencies.resolvePrincipal(input.accessToken); }
      catch { return fail("temporarily_unavailable", "Your access could not be verified. Try again."); }
      const decision = authorize(principal, { workspace: "admin", action: "admission:invite" });
      if (!decision.allowed) return fail(decision.reason === "unauthenticated" || decision.reason === "email-unverified" ? "unauthenticated" : "forbidden", "You are not allowed to send this invitation.");
      if (!uuidPattern.test(input.deliveryId)) return fail("validation_failed", "Check the invitation identifier.");

      const operationId = input.operationId ?? createOperationId();
      if (!uuidPattern.test(operationId)) return fail("validation_failed", "The send request could not be started.");
      let context: InvitationDeliveryContext | null;
      try { context = await dependencies.getContext(input.deliveryId); }
      catch { return fail("temporarily_unavailable", "The invitation could not be loaded. Try again later."); }
      if (!context || context.deliveryId !== input.deliveryId) return fail("not_found", "The invitation could not be found.");
      if (context.admissionState !== "invited" || !emailPattern.test(context.recipientEmail) || context.recipientEmail !== context.recipientEmail.trim().toLowerCase()) {
        return fail("conflict", "This invitation is no longer eligible to send.");
      }

      let claim: Awaited<ReturnType<InvitationDeliveryServiceDependencies["beginAttempt"]>>;
      try { claim = await dependencies.beginAttempt({ deliveryId: context.deliveryId, operationId, startedByUserId: decision.principal.userId }); }
      catch { return fail("temporarily_unavailable", "The send status is uncertain. Check its delivery history before retrying."); }
      if (!claim) return fail("conflict", "This invitation is already being sent or has a result that needs review.");
      if (!claim.created) return fail("conflict", "Something changed. Reload and try again.");

      let finalState: "accepted" | "failed" | "unknown" = "unknown";
      let providerMessageId: string | undefined;
      let safeErrorCode = "delivery_outcome_unknown";
      try {
        let link: Awaited<ReturnType<AuthLinkProvider["createMagicLink"]>>;
        try {
          link = await dependencies.authProvider.createMagicLink({ emailNormalized: context.recipientEmail, redirectTo, kind: "invite" });
        } catch (error) {
          // After a previous invitation attempt, Auth may already have a user
          // for this email. Fall back only on a definitive rejection; never
          // turn a transport-uncertain create into another Auth operation.
          if (error instanceof SupabaseAuthLinkError && error.code === "provider_rejected") {
            link = await dependencies.authProvider.createMagicLink({ emailNormalized: context.recipientEmail, redirectTo, kind: "magiclink" });
          } else throw error;
        }
        try {
          const sent = await dependencies.emailProvider.sendAppInvitation({
            recipientEmail: context.recipientEmail,
            actionLink: link.actionLink,
            deliveryId: context.deliveryId,
            attemptId: claim.attempt.id,
            idempotencyKey: operationId,
          });
          finalState = sent.state;
          if (sent.state === "accepted") providerMessageId = sent.providerMessageId;
          if (sent.state !== "accepted") safeErrorCode = sent.safeErrorCode;
        } catch {
          // The send call may have committed before transport failure.
          finalState = "unknown";
          safeErrorCode = "delivery_outcome_unknown";
        }
      } catch (error) {
        if (error instanceof SupabaseAuthLinkError && error.code === "provider_outcome_unknown") {
          finalState = "unknown";
          safeErrorCode = "auth_link_outcome_unknown";
        } else {
          // A definitive Auth rejection means email was never attempted.
          finalState = "failed";
          safeErrorCode = "auth_link_unavailable";
        }
      }

      try {
        await dependencies.finishAttempt({
          attemptId: claim.attempt.id,
          state: finalState,
          ...(providerMessageId ? { providerMessageId } : {}),
          ...(finalState !== "accepted" ? { safeErrorCode } : {}),
          finishedAt: now().toISOString(),
        });
      } catch {
        return fail("provider_outcome_unknown", "The provider result could not be saved. Check delivery history before retrying.");
      }
      return {
        ok: true,
        value: {
          deliveryId: context.deliveryId,
          attemptId: claim.attempt.id,
          state: finalState,
          safeMessage: finalState === "accepted"
            ? "The email provider accepted the invitation for local delivery. This does not confirm inbox delivery."
            : finalState === "failed"
              ? "The invitation could not be sent. Review its status before retrying."
              : "The send outcome is unknown. Do not resend until delivery status is reconciled.",
        },
      };
    },

    async reconcile(input) {
      let principal;
      try { principal = await dependencies.resolvePrincipal(input.accessToken); }
      catch { return fail("temporarily_unavailable", "Your access could not be verified. Try again."); }
      const decision = authorize(principal, { workspace: "admin", action: "admission:invite" });
      if (!decision.allowed) return fail(decision.reason === "unauthenticated" || decision.reason === "email-unverified" ? "unauthenticated" : "forbidden", "You are not allowed to review this invitation.");
      if (!uuidPattern.test(input.deliveryId)) return fail("validation_failed", "Check the invitation identifier.");
      try {
        const [context, attempt] = await Promise.all([
          dependencies.getContext(input.deliveryId),
          dependencies.getLatestAttempt(input.deliveryId),
        ]);
        if (!context || !attempt || context.deliveryId !== input.deliveryId) return fail("not_found", "The invitation attempt could not be found.");
        if (attempt.state !== "unknown") return fail("conflict", "Only an unknown attempt can be reconciled.");
        const result = await dependencies.emailProvider.reconcile({
          deliveryId: context.deliveryId,
          attemptId: attempt.id,
          recipientEmail: context.recipientEmail,
          ...(attempt.provider_message_id ? { providerMessageId: attempt.provider_message_id } : {}),
        });
        const state = result.state === "delivered" ? "accepted" : result.state;
        if (state !== "unknown") {
          await dependencies.reconcileAttempt({
            attemptId: attempt.id,
            state,
            ...(result.providerMessageId ? { providerMessageId: result.providerMessageId } : {}),
            resolvedAt: now().toISOString(),
          });
        }
        return {
          ok: true,
          value: {
            deliveryId: context.deliveryId,
            attemptId: attempt.id,
            state,
            safeMessage: state === "accepted"
              ? "The provider record matches this recipient. The email was accepted, but delivery is not confirmed."
              : state === "failed"
                ? "The provider confirmed the email was not accepted. Review its status before retrying."
                : "The provider result is still unknown. Do not resend this invitation.",
          },
        };
      } catch {
        return fail("temporarily_unavailable", "The invitation status could not be reconciled. No new email was sent.");
      }
    },
  });
}
