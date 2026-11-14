import { createFileRoute } from "@tanstack/react-router";
import { env } from "node:process";
import { createWaitlistPostHandler } from "../../server/waitlist.http.server.ts";
import { createWaitlistService } from "../../server/waitlist.service.server.ts";
import { createWaitlistRepository } from "../../server/waitlist.repository.server.ts";
import type { SupabaseServerConfig } from "../../server/supabase.server.ts";

function createServiceFromServerEnvironment() {
  const url = env.SUPABASE_URL?.trim();
  const publishableKey = (env.SUPABASE_PUBLISHABLE_KEY ?? env.SUPABASE_ANON_KEY)?.trim();
  const secretKey = (env.SUPABASE_SECRET_KEY ?? env.SUPABASE_SERVICE_ROLE_KEY)?.trim();
  if (!url || !publishableKey || !secretKey) throw new Error("server_configuration_unavailable");

  const config: SupabaseServerConfig = { url, publishableKey, secretKey };
  return createWaitlistService({ repository: createWaitlistRepository(config) });
}

const postWaitlist = createWaitlistPostHandler(createServiceFromServerEnvironment, {
  allowedOrigin: env.MARKETING_ORIGIN,
  mode: env.NODE_ENV === "production" ? "production" : "development",
});

export const Route = createFileRoute("/api/waitlist")({
  server: {
    handlers: {
      POST: async ({ request }) => postWaitlist(request),
      OPTIONS: async ({ request }) => postWaitlist(request),
    },
  },
});
