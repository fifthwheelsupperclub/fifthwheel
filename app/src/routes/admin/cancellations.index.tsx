import { createFileRoute } from "@tanstack/react-router";
import { AdminCancellationsQueue } from "../../components/seat-cancellation-workspaces.tsx";

export const Route = createFileRoute("/admin/cancellations/")({ component: AdminCancellationsQueue });
