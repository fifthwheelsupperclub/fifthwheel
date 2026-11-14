import { createFileRoute } from "@tanstack/react-router";
import { AdminOverview } from "../../components/ops-workspaces.tsx";

export const Route = createFileRoute("/admin/")({ component: AdminOverview });
