import { createFileRoute, Outlet, useRouterState } from "@tanstack/react-router";
import { AdminRefundsQueue } from "../../components/refund-workspaces.tsx";

export const Route = createFileRoute("/admin/refunds")({ component: RefundsRouteLayout });

function RefundsRouteLayout() {
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  return pathname === "/admin/refunds" ? <AdminRefundsQueue /> : <Outlet />;
}
