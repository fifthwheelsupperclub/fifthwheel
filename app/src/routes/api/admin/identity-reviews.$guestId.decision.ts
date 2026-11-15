import { createFileRoute } from "@tanstack/react-router";
import { profileHttpHandlers } from "../../../server/profile.http.runtime.server.ts";

export const Route = createFileRoute("/api/admin/identity-reviews/$guestId/decision")({
  server: { handlers: { POST: async ({ request, params }) => profileHttpHandlers.adminDecision(request, params) } },
});
