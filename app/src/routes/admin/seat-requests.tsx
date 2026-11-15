import { createFileRoute, Outlet, useRouterState } from "@tanstack/react-router";
import { AdminSeatRequestsQueue } from "../../components/roster-curation-workspace.tsx";

export const Route = createFileRoute("/admin/seat-requests")({ component: SeatRequestsRouteLayout });

function SeatRequestsRouteLayout() {
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  return pathname === "/admin/seat-requests" ? <AdminSeatRequestsQueue /> : <Outlet />;
}
