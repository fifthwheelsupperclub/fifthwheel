import { createFileRoute } from "@tanstack/react-router";
import { runRosterRouteHandler } from "../../../server/roster.route-runtime.server.ts";

export const Route = createFileRoute("/api/curation/assigned-tables")({
  server: { handlers: { GET: async ({ request }) => runRosterRouteHandler((handlers) => handlers.listAssignedCurationTables(request)) } },
});
