import { createFileRoute } from "@tanstack/react-router";
import { runOps } from "../../../server/ops.server.ts";

export const Route = createFileRoute("/api/admin/conduct-reports/$reportId")({ server: { handlers: { POST: async ({ request, params }) => runOps("conductReportUpdate", request, params) } } });
