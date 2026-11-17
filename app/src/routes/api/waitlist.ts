import { createFileRoute } from "@tanstack/react-router";
import { env } from "node:process";
import { createBoundedWaitlistRateLimiter, createWaitlistPostHandler } from "../../server/waitlist.http.server.ts";
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

// ponytail: one process-local bucket shared by every caller (no trusted client address behind the proxy), 60 signups per 10 minutes.
// It caps abuse on a single instance but a flood can also block honest signups; upgrade to a durable per-address limiter before running more than one instance.
const postWaitlist = createWaitlistPostHandler(createServiceFromServerEnvironment, {
  allowedOrigin: env.MARKETING_ORIGIN,
  mode: env.NODE_ENV === "production" ? "production" : "development",
  limiter: createBoundedWaitlistRateLimiter({ maxRequests: 60, windowMs: 10 * 60 * 1000 }),
});

export const Route = createFileRoute("/api/waitlist")({
  server: {
    handlers: {
      POST: async ({ request }) => postWaitlist(request),
      OPTIONS: async ({ request }) => postWaitlist(request),
    },
  },
});
