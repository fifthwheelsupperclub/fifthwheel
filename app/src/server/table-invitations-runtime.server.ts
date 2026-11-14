/** Server-only composition root for W06.5 Table-invitation endpoints. */

import { env } from "node:process";
import { createVerifiedPrincipalResolver } from "./principal.server.ts";
import { createSupabaseServerClient, type SupabaseServerConfig } from "./supabase.server.ts";
import { createTableInvitationRepository } from "./table-invitations.repository.server.ts";
import { createTableInvitationDeliveryWorkerRepository } from "./table-invitations.repository.server.ts";
import { createTableInvitationService } from "./table-invitations.service.server.ts";
import { createTableInvitationHttpHandlers } from "./table-invitations.http.server.ts";
import { createMailpitTableInvitationEmailProvider } from "./table-invitation.email.mailpit.server.ts";
import { createTableInvitationDeliveryWorker } from "./table-invitation-delivery.worker.server.ts";

function required(name: string, value: string | undefined): string {
  const normalized = value?.trim(); if (!normalized) throw new Error(`${name}_unavailable`); return normalized;
}

export function createTableInvitationRuntime(environment: Readonly<Record<string, string | undefined>> = env) {
  const config = supabaseConfig(environment);
  const supabase = createSupabaseServerClient(config);
  return createTableInvitationService({ resolvePrincipal: createVerifiedPrincipalResolver(supabase),
    repository: createTableInvitationRepository(config),
    reconcileUnknownDelivery: async (invitationId, expectedAttemptCount) => {
      const result = await createTableInvitationDeliveryWorkerRuntime(environment).reconcileUnknown(invitationId, expectedAttemptCount);
      return { invitationId: result.invitationId, deliveryState: result.state, attemptCount: result.attemptNumber };
    } });
}

function supabaseConfig(environment: Readonly<Record<string, string | undefined>>): SupabaseServerConfig {
  return {
    url: required("SUPABASE_URL", environment.SUPABASE_URL),
    publishableKey: required("SUPABASE_PUBLISHABLE_KEY", environment.SUPABASE_PUBLISHABLE_KEY ?? environment.SUPABASE_ANON_KEY),
    secretKey: required("SUPABASE_SECRET_KEY", environment.SUPABASE_SECRET_KEY ?? environment.SUPABASE_SERVICE_ROLE_KEY),
  };
}

export function createTableInvitationDeliveryWorkerRuntime(environment: Readonly<Record<string, string | undefined>> = env) {
  const config = supabaseConfig(environment);
  const emailProvider = createMailpitTableInvitationEmailProvider({
    baseUrl: required("MAILPIT_URL", environment.MAILPIT_URL),
    appOrigin: required("APP_ORIGIN", environment.APP_ORIGIN),
    fromEmail: environment.EMAIL_FROM?.trim() || "fifthwheel@example.test",
    fromName: environment.EMAIL_FROM_NAME?.trim() || "Fifth Wheel",
  });
  return createTableInvitationDeliveryWorker({ repository: createTableInvitationDeliveryWorkerRepository(config), emailProvider });
}

export function createTableInvitationHttpRuntime(environment: Readonly<Record<string, string | undefined>> = env) {
  const appOrigin = required("APP_ORIGIN", environment.APP_ORIGIN);
  return createTableInvitationHttpHandlers(() => createTableInvitationRuntime(environment), appOrigin);
}
