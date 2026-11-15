import { createFileRoute } from "@tanstack/react-router";
import { MemberSeatsListWorkspace } from "../components/member-seats-workspace.tsx";

export const Route = createFileRoute("/my-seats/")({ component: MemberSeatsListWorkspace });
