import { createFileRoute } from "@tanstack/react-router";
import { AdminStaffAssignments } from "../../components/ops-workspaces.tsx";

export const Route = createFileRoute("/admin/staff-assignments")({ component: AdminStaffAssignments });
