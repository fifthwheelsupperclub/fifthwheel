import { createFileRoute } from "@tanstack/react-router";
import { AdminConductReports } from "../../components/ops-workspaces.tsx";

export const Route = createFileRoute("/admin/conduct-reports")({ component: AdminConductReports });
