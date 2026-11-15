import { createFileRoute } from "@tanstack/react-router";
import { runOps } from "../../../server/ops.server.ts";

export const Route = createFileRoute("/api/admin/notices")({ server: { handlers: { GET: async ({ request }) => runOps("noticeProblems", request) } } });
