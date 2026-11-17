import { createFileRoute } from "@tanstack/react-router";
import { runOps } from "../../../server/ops.server.ts";

export const Route = createFileRoute("/api/host/tables")({ server: { handlers: { GET: async ({ request }) => runOps("hostTables", request) } } });
