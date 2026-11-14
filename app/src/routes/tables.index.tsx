import { createFileRoute } from "@tanstack/react-router";
import { MemberTablesWorkspace } from "../components/member-tables-workspace.tsx";

export const Route = createFileRoute("/tables/")({ component: MemberTablesWorkspace });
