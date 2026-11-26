import type { BetterAuthClientPlugin } from "better-auth/client";

/**
 * Support for Tab acting as an OAuth server for MCP clients (Claude, ChatGPT…).
 *
 * When `/api/auth/oauth2/authorize` needs the user to sign in or consent, it
 * redirects here with the authorize parameters as a signed query (`sig`,
 * `ba_param`…). Sign-in and consent requests must send that query back as
 * `oauth_query`; the server verifies it and resumes the flow, replying with
 * `{ redirect: true, url }`.
 *
 * Mirrors `oauthProviderClient()` from `@better-auth/oauth-provider/client`,
 * vendored so the PWA doesn't pull the server package (and its zod 4 peer)
 * into the browser bundle.
 */

/** The signed OAuth query on the current page, or undefined outside an OAuth flow. */
export function getSignedOAuthQuery(search?: string): string | undefined {
  if (typeof window === "undefined" && search === undefined) return undefined;
  const params = new URLSearchParams(search ?? window.location.search);
  if (!params.has("sig")) return undefined;
  const signedNames = new Set(params.getAll("ba_param"));
  if (signedNames.size === 0) return undefined;
  const out = new URLSearchParams();
  for (const [key, value] of params.entries()) {
    if (key === "sig" || key === "ba_param" || signedNames.has(key)) out.append(key, value);
  }
  return out.toString();
}

export function isOAuthFlow(): boolean {
  return getSignedOAuthQuery() !== undefined;
}

export const oauthFlowClient = () =>
  ({
    id: "oauth-provider-client",
    fetchPlugins: [
      {
        id: "oauth-provider-signin",
        name: "oauth-provider-signin",
        hooks: {
          async onRequest(ctx) {
            if (ctx.method === "GET" || ctx.method === "DELETE") return;
            const oauthQuery = getSignedOAuthQuery();
            if (!oauthQuery) return;
            if (ctx.body && typeof ctx.body !== "string") return;
            const body = await new Response(ctx.body ?? "{}").json().catch(() => null);
            if (typeof body !== "object" || body === null || Array.isArray(body)) return;
            if ("oauth_query" in body && body.oauth_query) return;
            ctx.headers.set("content-type", "application/json");
            ctx.body = JSON.stringify({ ...body, oauth_query: oauthQuery });
          },
        },
      },
    ],
  }) satisfies BetterAuthClientPlugin;

/** Follows the `{ redirect: true, url }` reply that resumes the OAuth flow. */
export function followOAuthRedirect(data: unknown): boolean {
  if (data && typeof data === "object" && "url" in data && typeof data.url === "string") {
    window.location.href = data.url;
    return true;
  }
  return false;
}

/** POST /oauth2/consent with the signed query from this page. */
export async function submitOAuthConsent(accept: boolean, apiBase: string): Promise<string> {
  const oauthQuery = getSignedOAuthQuery();
  if (!oauthQuery) throw new Error("This page is missing its sign-in details. Start again from the app.");
  const res = await fetch(`${apiBase}/api/auth/oauth2/consent`, {
    method: "POST",
    credentials: "include",
    headers: { "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify({ accept, oauth_query: oauthQuery }),
  });
  const data = (await res.json().catch(() => null)) as
    | { url?: string; error_description?: string; message?: string }
    | null;
  if (!res.ok || !data?.url) {
    throw new Error(data?.error_description ?? data?.message ?? "Could not complete the connection");
  }
  return data.url;
}
