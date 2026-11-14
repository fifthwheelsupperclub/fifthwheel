import { createFileRoute } from "@tanstack/react-router";
import { AdminSupplyWeeklyClone } from "../../components/admin-supply-weekly-clone.tsx";

export const Route = createFileRoute("/admin/tables/weekly-clone")({
  component: AdminSupplyWeeklyClone,
});
