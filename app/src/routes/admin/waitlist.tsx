import { createFileRoute } from "@tanstack/react-router";
import { AdminPlacementQueue } from "../../components/ops-workspaces.tsx";

export const Route = createFileRoute("/admin/waitlist")({ component: AdminPlacementQueue });
