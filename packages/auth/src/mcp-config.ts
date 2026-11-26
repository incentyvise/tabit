/**
 * Shared configuration for Tab's MCP server and the OAuth authorization server
 * that protects it. The API mounts the MCP endpoint at `${apiBaseUrl}/mcp`.
 */

function stripTrailingSlash(url: string): string {
  return url.replace(/\/+$/, "");
}

/** Public base URL of the API (Better Auth `baseURL`). */
export function getApiBaseUrl(): string {
  return stripTrailingSlash(
    process.env.VITE_API_URL ?? process.env.VITE_BACKEND_URL ?? "http://localhost:3001",
  );
}

/** Public URL of the PWA, which hosts the login and consent screens. */
export function getPwaUrl(): string {
  const first = (process.env.NEXT_PUBLIC_PWA_URL ?? process.env.CORS_ORIGIN ?? "")
    .split(",")
    .map((s) => s.trim())
    .find(Boolean);
  return stripTrailingSlash(first ?? "http://localhost:3003");
}

/** MCP is on by default; set `MCP_ENABLED=false` (or `0`) to turn it off. */
export function isMcpEnabled(): boolean {
  const raw = (process.env.MCP_ENABLED ?? "").trim().toLowerCase();
  return !(raw === "false" || raw === "0" || raw === "off" || raw === "no");
}

/** Canonical protected-resource identifier; access tokens carry it as `aud`. */
export function getMcpResource(): string {
  return `${getApiBaseUrl()}/mcp`;
}

export const MCP_READ_SCOPE = "tab:read";
export const MCP_WRITE_SCOPE = "tab:write";

/** Human-readable descriptions shown on the consent screen. */
export const MCP_SCOPE_DESCRIPTIONS: Record<string, string> = {
  [MCP_READ_SCOPE]: "See your tabs, friends, balances, expenses and settlements",
  [MCP_WRITE_SCOPE]:
    "Add, edit and delete expenses and settlements, manage tabs, and send friend requests, pokes and payment reminders",
  offline_access: "Stay connected without asking you to sign in again",
  openid: "Confirm your identity",
  profile: "See your name and username",
};

export { KNOWN_MCP_CLIENT_HOSTS, knownClientForHost, hostOf, describeOAuthClient } from "shared";
