import { createFileRoute } from "@tanstack/react-router";
import { IdentityReviewRouteLayout } from "../../components/identity-review-workspace.tsx";

export const Route = createFileRoute("/admin/identity-review")({ component: IdentityReviewRouteLayout });
