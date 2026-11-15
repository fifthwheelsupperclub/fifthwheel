import { createFileRoute } from "@tanstack/react-router";
import { HostAssignedTablesQueue } from "../../components/roster-curation-workspace.tsx";

export const Route = createFileRoute("/host/assigned-tables")({ component: HostAssignedTablesQueue });
