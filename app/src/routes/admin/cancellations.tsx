import { createFileRoute, Outlet, useRouterState } from "@tanstack/react-router";
import { AdminCancellationsQueue } from "../../components/seat-cancellation-workspaces.tsx";

export const Route = createFileRoute("/admin/cancellations")({ component: CancellationsRouteLayout });

function CancellationsRouteLayout() {
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  return pathname === "/admin/cancellations" ? <AdminCancellationsQueue /> : <Outlet />;
}
