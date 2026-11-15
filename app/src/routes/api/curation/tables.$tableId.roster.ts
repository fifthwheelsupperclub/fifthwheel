import { createFileRoute } from "@tanstack/react-router";
import { runRosterRouteHandler } from "../../../server/roster.route-runtime.server.ts";

export const Route = createFileRoute("/api/curation/tables/$tableId/roster")({
  server: { handlers: { GET: async ({ request, params }) => runRosterRouteHandler((handlers) => handlers.readTableRoster(request, params.tableId)) } },
});
