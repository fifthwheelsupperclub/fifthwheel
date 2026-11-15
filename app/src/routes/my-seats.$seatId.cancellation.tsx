import { createFileRoute } from "@tanstack/react-router";
import { MemberSeatCancellationWorkspace } from "../components/seat-cancellation-workspaces.tsx";

export const Route = createFileRoute("/my-seats/$seatId/cancellation")({ component: SeatCancellationRoute });

function SeatCancellationRoute() {
  const { seatId } = Route.useParams();
  return <MemberSeatCancellationWorkspace seatId={seatId} />;
}
