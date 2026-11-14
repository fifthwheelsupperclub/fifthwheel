import { createFileRoute } from "@tanstack/react-router";
import { IdentityReviewDetail } from "../../components/identity-review-workspace.tsx";

export const Route = createFileRoute("/admin/identity-review/$guestId")({
  component: IdentityReviewDetailRoute,
});

function IdentityReviewDetailRoute() {
  const { guestId } = Route.useParams();
  return <IdentityReviewDetail guestId={guestId} />;
}
