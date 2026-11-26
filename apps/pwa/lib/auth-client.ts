import { createAuthClient } from "better-auth/react";
import { inferAdditionalFields } from "better-auth/client/plugins";
import { emailOTPClient } from "better-auth/client/plugins";
import { oauthFlowClient } from "./oauth-flow";

export function getAuthBaseUrl(): string {
  const apiBase = import.meta.env.VITE_API_URL ?? import.meta.env.VITE_BACKEND_URL;
  if (apiBase) return apiBase.replace(/\/$/, "");
  if (typeof window !== "undefined") return window.location.origin;
  return import.meta.env.NEXT_PUBLIC_PWA_URL ?? "http://localhost:3003";
}

export const authClient = createAuthClient({
  baseURL: getAuthBaseUrl(),
  fetchOptions: {
    credentials: "include",
  },
  plugins: [
    emailOTPClient(),
    oauthFlowClient(),
    inferAdditionalFields({
      user: {
        username: { type: "string", required: false },
      },
    }),
  ],
});
