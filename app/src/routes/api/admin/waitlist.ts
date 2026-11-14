import { createFileRoute } from "@tanstack/react-router";
import { env } from "node:process";
import { createAdmissionRepository } from "../../../server/admission.repository.server.ts";
import { createAdmissionService } from "../../../server/admission.service.server.ts";
import { createAdminWaitlistGetHandler, createAdminWaitlistInvitePostHandler } from "../../../server/admin.waitlist.http.server.ts";
import { createVerifiedPrincipalResolver } from "../../../server/principal.server.ts";
import { createSupabaseServerClient, type SupabaseServerConfig } from "../../../server/supabase.server.ts";
import { createWaitlistSearchRepository } from "../../../server/waitlist.search.repository.server.ts";

function createServiceFromServerEnvironment() {
  const url = env.SUPABASE_URL?.trim();
  const publishableKey = (env.SUPABASE_PUBLISHABLE_KEY ?? env.SUPABASE_ANON_KEY)?.trim();
  const secretKey = (env.SUPABASE_SECRET_KEY ?? env.SUPABASE_SERVICE_ROLE_KEY)?.trim();
  if (!url || !publishableKey || !secretKey) throw new Error("server_configuration_unavailable");

  const config: SupabaseServerConfig = { url, publishableKey, secretKey };
  const supabase = createSupabaseServerClient(config);
  return createAdmissionService({
    resolvePrincipal: createVerifiedPrincipalResolver(supabase),
    waitlistRepository: createWaitlistSearchRepository(config),
    admissionRepository: createAdmissionRepository(config),
  });
}

const getWaitlist = createAdminWaitlistGetHandler(createServiceFromServerEnvironment);
const postInvitation = createAdminWaitlistInvitePostHandler(createServiceFromServerEnvironment, env.APP_ORIGIN);

export const Route = createFileRoute("/api/admin/waitlist")({
  server: {
    handlers: {
      GET: async ({ request }) => getWaitlist(request),
      POST: async ({ request }) => postInvitation(request),
    },
  },
});
