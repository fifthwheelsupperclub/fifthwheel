import { createFileRoute } from "@tanstack/react-router";
import { runOps } from "../../../server/ops.server.ts";

export const Route = createFileRoute("/api/me/tables/$tableId/reveal")({ server: { handlers: { GET: async ({ request, params }) => runOps("reveal", request, params) } } });
