import { createFileRoute } from "@tanstack/react-router";
import { runOps } from "../../../server/ops.server.ts";

export const Route = createFileRoute("/api/admin/overview")({ server: { handlers: { GET: async ({ request }) => runOps("adminOverview", request) } } });
