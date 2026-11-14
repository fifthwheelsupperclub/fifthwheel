import { createFileRoute } from "@tanstack/react-router";
import { MemberRequestsWorkspace } from "../components/member-tables-workspace.tsx";

export const Route = createFileRoute("/requests")({ component: MemberRequestsWorkspace });
