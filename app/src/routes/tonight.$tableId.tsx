import { createFileRoute } from "@tanstack/react-router";
import { TonightWorkspace } from "../components/tonight-workspace.tsx";

export const Route = createFileRoute("/tonight/$tableId")({ component: TonightRoute });
function TonightRoute() { return <TonightWorkspace tableId={Route.useParams().tableId} />; }
