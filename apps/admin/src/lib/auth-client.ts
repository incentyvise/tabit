import { createAuthClient } from "better-auth/react";
import { adminClient, emailOTPClient } from "better-auth/client/plugins";
import { apiBaseUrl } from "./config";

export const authClient = createAuthClient({
  baseURL: apiBaseUrl || window.location.origin,
  fetchOptions: {
    credentials: "include",
  },
  plugins: [emailOTPClient(), adminClient()],
});
