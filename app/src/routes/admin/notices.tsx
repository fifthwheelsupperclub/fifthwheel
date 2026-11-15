import { createFileRoute } from "@tanstack/react-router";
import { AdminNoticeProblems } from "../../components/ops-workspaces.tsx";

export const Route = createFileRoute("/admin/notices")({ component: AdminNoticeProblems });
