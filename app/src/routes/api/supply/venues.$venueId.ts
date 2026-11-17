import { createFileRoute } from "@tanstack/react-router";
import { env } from "node:process";
import { createSupplyManagementHttpHandlers } from "../../../server/supply.management.http.server.ts";
import { createSupplyRuntime } from "../../../server/supply-runtime.server.ts";

export const Route = createFileRoute("/api/supply/venues/$venueId")({
  server: {
    handlers: {
      PUT: async ({ request, params }) => createSupplyManagementHttpHandlers(() => createSupplyRuntime().managementService, env.APP_ORIGIN).saveVenue(request, params.venueId),
    },
  },
});
