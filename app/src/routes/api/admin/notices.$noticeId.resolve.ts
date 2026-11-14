import { createFileRoute } from "@tanstack/react-router";
import { runOps } from "../../../server/ops.server.ts";

export const Route = createFileRoute("/api/admin/notices/$noticeId/resolve")({ server: { handlers: { POST: async ({ request, params }) => runOps("resolveNotice", request, params) } } });
