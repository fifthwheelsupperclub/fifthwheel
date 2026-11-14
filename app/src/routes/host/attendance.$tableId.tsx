import { createFileRoute } from "@tanstack/react-router";
import { HostTableAttendance } from "../../components/ops-workspaces.tsx";

export const Route = createFileRoute("/host/attendance/$tableId")({ component: HostAttendanceRoute });
function HostAttendanceRoute() { return <HostTableAttendance tableId={Route.useParams().tableId} />; }
