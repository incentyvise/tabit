import { createFileRoute } from "@tanstack/react-router";
import { OAuthConsentPage } from "@/app/oauth/consent/page";

export const Route = createFileRoute("/oauth/consent")({
  component: OAuthConsentPage,
});
