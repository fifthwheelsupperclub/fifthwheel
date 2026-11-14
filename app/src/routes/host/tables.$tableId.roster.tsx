import { createFileRoute } from "@tanstack/react-router";
import { HostTableRosterProposal } from "../../components/roster-curation-workspace.tsx";

export const Route = createFileRoute("/host/tables/$tableId/roster")({ component: HostTableRosterRoute });

function HostTableRosterRoute() {
  const { tableId } = Route.useParams();
  return <HostTableRosterProposal tableId={tableId} />;
}
