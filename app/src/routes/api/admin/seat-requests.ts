import { createFileRoute } from "@tanstack/react-router";
import { runRosterRouteHandler } from "../../../server/roster.route-runtime.server.ts";

export const Route = createFileRoute("/api/admin/seat-requests")({
  server: { handlers: { GET: async ({ request }) => runRosterRouteHandler((handlers) => handlers.listAdminSeatRequests(request)) } },
});
