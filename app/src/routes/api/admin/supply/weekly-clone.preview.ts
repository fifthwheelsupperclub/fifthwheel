import { createFileRoute } from "@tanstack/react-router";
import { weeklyCloneHandlers } from "../../../../server/supply.weekly-clone.route.server.ts";

export const Route = createFileRoute("/api/admin/supply/weekly-clone/preview")({
  server: { handlers: { POST: async ({ request }) => weeklyCloneHandlers().preview(request) } },
});
