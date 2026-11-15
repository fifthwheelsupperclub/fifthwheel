import { createFileRoute } from "@tanstack/react-router";
import { runOps } from "../../../server/ops.server.ts";

export const Route = createFileRoute("/api/admin/conduct-reports")({ server: { handlers: { GET: async ({ request }) => runOps("conductReports", request) } } });
