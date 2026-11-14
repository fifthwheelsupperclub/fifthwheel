import { createFileRoute } from "@tanstack/react-router";
import { runOps } from "../../../server/ops.server.ts";

export const Route = createFileRoute("/api/host/cancellations/$requestId/flag")({ server: { handlers: { POST: async ({ request, params }) => runOps("flagCancellation", request, params) } } });
