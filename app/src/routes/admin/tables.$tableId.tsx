import { createFileRoute } from "@tanstack/react-router";
import { AdminSupplyTableDetail } from "../../components/admin-supply-management-workspace.tsx";

export const Route = createFileRoute("/admin/tables/$tableId")({
  component: TableSupplyDetailRoute,
});

function TableSupplyDetailRoute() {
  const { tableId } = Route.useParams();
  return <AdminSupplyTableDetail tableId={tableId} />;
}
