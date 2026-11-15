import { createFileRoute } from "@tanstack/react-router";
import { createAuthHttpHandlers } from "../../../server/auth.http.server.ts";
import { createAuthService } from "../../../server/auth.service.server.ts";
import { createAdmissionRuntime } from "../../../server/admission-runtime.server.ts";

function createHandlers() {
  const runtime = createAdmissionRuntime();
  const service = createAuthService({
    admissionRepository: runtime.admissionRepository,
    linkRequestRepository: runtime.memberLinkRepository,
    authProvider: runtime.authProvider,
    verifyExistingAccessToken: (accessToken) => runtime.supabase.verifyAccessToken(accessToken),
    appOrigin: runtime.appOrigin,
    sendLink: async (input) => {
      const result = await runtime.magicLinkEmailProvider.sendSignInLink(input);
      return { state: result.state };
    },
  });
  return createAuthHttpHandlers(service, runtime.appOrigin);
}

export const Route = createFileRoute("/api/auth/request-link")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        try {
          return await createHandlers().requestLink(request);
        } catch {
          return Response.json({ error: { code: "temporarily_unavailable", message: "Your sign-in link could not be requested. Try again." } }, {
            status: 503,
            headers: { "cache-control": "no-store" },
          });
        }
      },
    },
  },
});
