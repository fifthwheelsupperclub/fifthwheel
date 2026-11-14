import { createFileRoute } from "@tanstack/react-router";
import { AdminSeatRequestRoster } from "../../components/roster-curation-workspace.tsx";

export const Route = createFileRoute("/admin/seat-requests/$tableId")({ component: AdminSeatRequestRosterRoute });

function AdminSeatRequestRosterRoute() {
  const { tableId } = Route.useParams();
  return <AdminSeatRequestRoster tableId={tableId} />;
}
