import { createFileRoute } from "@tanstack/react-router";
import { runRosterRouteHandler } from "../../../server/roster.route-runtime.server.ts";

export const Route = createFileRoute("/api/admin/seat-requests/$tableId/approve")({
  server: { handlers: { POST: async ({ request, params }) => runRosterRouteHandler((handlers) => handlers.approveRoster(request, params.tableId)) } },
});
