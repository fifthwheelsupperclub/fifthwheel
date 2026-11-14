import { createFileRoute } from "@tanstack/react-router";
import { runRosterRouteHandler } from "../../../server/roster.route-runtime.server.ts";

export const Route = createFileRoute("/api/curation/tables/$tableId/roster-proposal")({
  server: { handlers: { PUT: async ({ request, params }) => runRosterRouteHandler((handlers) => handlers.saveRosterProposal(request, params.tableId)) } },
});
