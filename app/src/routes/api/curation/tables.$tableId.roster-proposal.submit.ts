import { createFileRoute } from "@tanstack/react-router";
import { runRosterRouteHandler } from "../../../server/roster.route-runtime.server.ts";

export const Route = createFileRoute("/api/curation/tables/$tableId/roster-proposal/submit")({
  server: { handlers: { POST: async ({ request, params }) => runRosterRouteHandler((handlers) => handlers.submitRosterProposal(request, params.tableId)) } },
});
