import { createFileRoute } from "@tanstack/react-router";
import { MemberTableInvitationWorkspace } from "../components/table-invitation-workspaces.tsx";

export const Route = createFileRoute("/invitations/$invitationId")({
  head: () => ({ meta: [{ name: "referrer", content: "no-referrer" }] }),
  component: InvitationDetailRoute,
});

function InvitationDetailRoute() {
  const { invitationId } = Route.useParams();
  return <MemberTableInvitationWorkspace invitationId={invitationId} />;
}
