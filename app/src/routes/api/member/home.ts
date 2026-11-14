import { createFileRoute } from "@tanstack/react-router";
import { env } from "node:process";
import { createMemberHomeGetHandler } from "../../../server/member.home.http.server.ts";
import { createVerifiedPrincipalResolver } from "../../../server/principal.server.ts";
import { createSupabaseServerClient, type SupabaseServerConfig } from "../../../server/supabase.server.ts";

function createPrincipalResolverFromServerEnvironment() {
  const url = env.SUPABASE_URL?.trim();
  const publishableKey = (env.SUPABASE_PUBLISHABLE_KEY ?? env.SUPABASE_ANON_KEY)?.trim();
  const secretKey = (env.SUPABASE_SECRET_KEY ?? env.SUPABASE_SERVICE_ROLE_KEY)?.trim();
  if (!url || !publishableKey || !secretKey) throw new Error("server_configuration_unavailable");

  const config: SupabaseServerConfig = { url, publishableKey, secretKey };
  return createVerifiedPrincipalResolver(createSupabaseServerClient(config));
}

const getMemberHome = createMemberHomeGetHandler(async (accessToken) =>
  await createPrincipalResolverFromServerEnvironment()(accessToken));

export const Route = createFileRoute("/api/member/home")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        try {
          return await getMemberHome(request);
        } catch {
          return Response.json({ error: { code: "temporarily_unavailable", message: "Your member home is temporarily unavailable." } }, {
            status: 503,
            headers: { "cache-control": "no-store", vary: "Cookie" },
          });
        }
      },
    },
  },
});
