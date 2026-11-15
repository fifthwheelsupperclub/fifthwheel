import { createFileRoute } from "@tanstack/react-router";
import { AdminCancellationDetail } from "../../components/seat-cancellation-workspaces.tsx";

export const Route = createFileRoute("/admin/cancellations/$requestId")({ component: AdminCancellationDetailRoute });

function AdminCancellationDetailRoute() {
  const { requestId } = Route.useParams();
  return <AdminCancellationDetail requestId={requestId} />;
}
