import { createFileRoute } from "@tanstack/react-router";
import { MemberSeatDetailWorkspace } from "../components/member-seats-workspace.tsx";

export const Route = createFileRoute("/my-seats/$seatId/")({ component: SeatDetailRoute });

function SeatDetailRoute() {
  const { seatId } = Route.useParams();
  return <MemberSeatDetailWorkspace seatId={seatId} />;
}
