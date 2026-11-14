import { createFileRoute } from "@tanstack/react-router";
import { profileHttpHandlers } from "../../../server/profile.http.runtime.server.ts";

export const Route = createFileRoute("/api/member/profile/files/$fileId/read-url")({
  server: { handlers: { POST: async ({ request, params }) => profileHttpHandlers.uploadReadUrl(request, params) } },
});
