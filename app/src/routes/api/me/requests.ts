import { createFileRoute } from "@tanstack/react-router";
import { env } from "node:process";
import { createTablesHttpHandlers } from "../../../server/tables.http.server.ts";
import { createTablesRuntime } from "../../../server/tables-runtime.server.ts";

function handlers() { return createTablesHttpHandlers(() => createTablesRuntime(), env.APP_ORIGIN); }

export const Route = createFileRoute("/api/me/requests")({
  server: { handlers: { GET: async ({ request }) => handlers().listRequests(request) } },
});
