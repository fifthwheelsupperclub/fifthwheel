import { createFileRoute } from "@tanstack/react-router";
import { HostAssignedTables } from "../../components/ops-workspaces.tsx";

export const Route = createFileRoute("/host/assigned-tables")({ component: HostAssignedTables });
