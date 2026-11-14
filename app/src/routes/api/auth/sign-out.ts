import { createFileRoute } from "@tanstack/react-router";
import { env } from "node:process";
import { createSignOutPostHandler } from "../../../server/auth.sign-out.http.server.ts";

export const Route = createFileRoute("/api/auth/sign-out")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        try {
          const appOrigin = env.APP_ORIGIN?.trim();
          const supabaseUrl = env.SUPABASE_URL?.trim();
          const publishableKey = (env.SUPABASE_PUBLISHABLE_KEY ?? env.SUPABASE_ANON_KEY)?.trim();
          if (!appOrigin || !supabaseUrl || !publishableKey) throw new Error("sign_out_configuration_unavailable");
          return await createSignOutPostHandler({ appOrigin, supabaseUrl, publishableKey })(request);
        } catch {
          return Response.json({ error: { code: "temporarily_unavailable", message: "Sign-out is temporarily unavailable." } }, {
            status: 503,
            headers: { "cache-control": "no-store", vary: "Cookie, Origin" },
          });
        }
      },
    },
  },
});
