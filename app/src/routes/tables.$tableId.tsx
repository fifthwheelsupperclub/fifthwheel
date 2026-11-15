import { createFileRoute } from "@tanstack/react-router";
import { MemberTableDetailWorkspace } from "../components/member-tables-workspace.tsx";

export const Route = createFileRoute("/tables/$tableId")({
  component: TableDetailRoute,
});

function TableDetailRoute() {
  const { tableId } = Route.useParams();
  return <MemberTableDetailWorkspace tableId={tableId} />;
}
