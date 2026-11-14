import { createFileRoute } from "@tanstack/react-router";
import { AdminTableDecisions } from "../../components/ops-workspaces.tsx";

export const Route = createFileRoute("/admin/table-decisions")({ component: AdminTableDecisions });
