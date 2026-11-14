import { createFileRoute } from "@tanstack/react-router";
import { AdminRefundDetail } from "../../components/refund-workspaces.tsx";

export const Route = createFileRoute("/admin/refunds/$obligationId")({ component: RefundDetailRoute });

function RefundDetailRoute() {
  const { obligationId } = Route.useParams();
  return <AdminRefundDetail obligationId={obligationId} />;
}
