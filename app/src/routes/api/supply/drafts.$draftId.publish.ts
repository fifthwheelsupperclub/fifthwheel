import { createFileRoute } from "@tanstack/react-router";
import { env } from "node:process";
import { createSupplyManagementHttpHandlers } from "../../../server/supply.management.http.server.ts";
import { createSupplyRuntime } from "../../../server/supply-runtime.server.ts";

function handlers() {
  return createSupplyManagementHttpHandlers(() => createSupplyRuntime().managementService, env.APP_ORIGIN);
}

export const Route = createFileRoute("/api/supply/drafts/$draftId/publish")({
  server: { handlers: { POST: async ({ request, params }) => handlers().publishDraft(request, params.draftId) } },
});
