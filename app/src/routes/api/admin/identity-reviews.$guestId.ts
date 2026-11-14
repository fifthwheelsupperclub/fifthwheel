import { createFileRoute } from "@tanstack/react-router";
import { profileHttpHandlers } from "../../../server/profile.http.runtime.server.ts";

export const Route = createFileRoute("/api/admin/identity-reviews/$guestId")({
  server: { handlers: { GET: async ({ request, params }) => profileHttpHandlers.adminDetail(request, params) } },
});
