import { createFileRoute } from "@tanstack/react-router";
import { env } from "node:process";
import { createWorkspacesGetHandler } from "../../server/workspaces.http.server.ts";
import { createVerifiedPrincipalResolver } from "../../server/principal.server.ts";
import { createSupplyTableAssignmentReader } from "../../server/supply-table-assignment-reader.server.ts";
import { createSupabaseServerClient, type SupabaseServerConfig } from "../../server/supabase.server.ts";

function createHandler() {
  const url = env.SUPABASE_URL?.trim();
  const publishableKey = (env.SUPABASE_PUBLISHABLE_KEY ?? env.SUPABASE_ANON_KEY)?.trim();
  const secretKey = (env.SUPABASE_SECRET_KEY ?? env.SUPABASE_SERVICE_ROLE_KEY)?.trim();
  if (!url || !publishableKey || !secretKey) throw new Error("server_configuration_unavailable");
  const config: SupabaseServerConfig = { url, publishableKey, secretKey };
  const supabase = createSupabaseServerClient(config);
  const assignments = createSupplyTableAssignmentReader(config);
  return createWorkspacesGetHandler(createVerifiedPrincipalResolver(supabase, assignments));
}

export const Route = createFileRoute("/api/workspaces")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        try {
          return await createHandler()(request);
        } catch {
          return Response.json({ error: { code: "temporarily_unavailable", message: "Your workspaces are temporarily unavailable." } }, {
            status: 503,
            headers: { "cache-control": "no-store", vary: "Cookie" },
          });
        }
      },
    },
  },
});
