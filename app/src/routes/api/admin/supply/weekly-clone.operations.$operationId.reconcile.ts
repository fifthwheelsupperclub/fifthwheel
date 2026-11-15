import { createFileRoute } from "@tanstack/react-router";
import { weeklyCloneHandlers } from "../../../../server/supply.weekly-clone.route.server.ts";

export const Route = createFileRoute("/api/admin/supply/weekly-clone/operations/$operationId/reconcile")({
  server: { handlers: { POST: async ({ request, params }) => weeklyCloneHandlers().reconcile(request, params.operationId) } },
});
