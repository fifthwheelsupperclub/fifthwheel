import { createFileRoute } from "@tanstack/react-router";
import { ProfileWorkspace } from "../../components/profile-workspace.tsx";

export const Route = createFileRoute("/account/profile")({ component: ProfileWorkspace });
