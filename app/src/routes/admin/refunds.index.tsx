import { createFileRoute } from "@tanstack/react-router";
import { AdminRefundsQueue } from "../../components/refund-workspaces.tsx";

export const Route = createFileRoute("/admin/refunds/")({ component: AdminRefundsQueue });
