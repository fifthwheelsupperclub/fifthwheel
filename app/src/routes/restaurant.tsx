import { createFileRoute } from "@tanstack/react-router";
import { RestaurantWorkspace } from "../components/ops-workspaces.tsx";

export const Route = createFileRoute("/restaurant")({ component: RestaurantWorkspace });
