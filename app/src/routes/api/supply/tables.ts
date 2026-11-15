import { createFileRoute } from "@tanstack/react-router";
import { env } from "node:process";
import { createSupplyManagementHttpHandlers } from "../../../server/supply.management.http.server.ts";
import { createSupplyRuntime } from "../../../server/supply-runtime.server.ts";

function handlers() {
  return createSupplyManagementHttpHandlers(() => createSupplyRuntime().managementService, env.APP_ORIGIN);
}

export const Route = createFileRoute("/api/supply/tables")({
  server: { handlers: { GET: async ({ request }) => handlers().listTables(request) } },
});
