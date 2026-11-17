import { createFileRoute } from "@tanstack/react-router";
import { runOps } from "../../../server/ops.server.ts";

export const Route = createFileRoute("/api/admin/placements")({
  server: { handlers: { GET: async ({ request }) => runOps("placementQueue", request), POST: async ({ request }) => runOps("place", request) } },
});
