import { createFileRoute } from "@tanstack/react-router";
import { profileHttpHandlers } from "../../../server/profile.http.runtime.server.ts";

export const Route = createFileRoute("/api/admin/identity-reviews")({
  server: { handlers: { GET: async ({ request }) => profileHttpHandlers.adminList(request) } },
});
