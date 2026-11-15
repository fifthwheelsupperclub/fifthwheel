import { createFileRoute, Outlet } from "@tanstack/react-router";

export const Route = createFileRoute("/tables")({ component: () => <Outlet /> });
