import { createFileRoute } from "@tanstack/react-router";
import { env } from "node:process";
import { createTablesHttpHandlers } from "../../server/tables.http.server.ts";
import { createTablesRuntime } from "../../server/tables-runtime.server.ts";

function handlers() { return createTablesHttpHandlers(() => createTablesRuntime(), env.APP_ORIGIN); }

export const Route = createFileRoute("/api/tables/$tableId")({
  server: { handlers: {
    GET: async ({ request, params }) => handlers().readTable(request, params.tableId),
    POST: async ({ request, params }) => handlers().createRequest(request, params.tableId),
  } },
});
