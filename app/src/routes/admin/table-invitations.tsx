import { createFileRoute } from "@tanstack/react-router";
import { AdminTableInvitationDeliveryWorkspace } from "../../components/table-invitation-workspaces.tsx";

export const Route = createFileRoute("/admin/table-invitations")({ component: AdminTableInvitationDeliveryWorkspace });
