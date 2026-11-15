import { createFileRoute } from "@tanstack/react-router";
import { AdminTablesRouteLayout } from "../../components/admin-supply-management-workspace.tsx";

export const Route = createFileRoute("/admin/tables")({ component: AdminTablesRouteLayout });
