import { z } from "zod";
import { ORPCError } from "@orpc/server";
import { auth, describeOAuthClient, hostOf, MCP_SCOPE_DESCRIPTIONS, verifyOAuthQueryParams } from "auth";
import { oauthApp } from "data";
import { authed } from "../auth-middleware.js";

/** Keeps only the signed OAuth parameters (the page may carry its own). */
function signedQuery(raw: string): URLSearchParams {
  const params = new URLSearchParams(raw.startsWith("?") ? raw.slice(1) : raw);
  const signed = new Set(["sig", "ba_param", ...params.getAll("ba_param")]);
  return new URLSearchParams([...params].filter(([key]) => signed.has(key)));
}

function httpsOrNull(uri: string | null | undefined): string | null {
  return uri && uri.startsWith("https://") ? uri : null;
}

export const connectedAppsProcedures = {
  /** MCP clients (Claude, ChatGPT, …) the user has connected. */
  list: authed.handler(async ({ context }) => {
    const apps = await oauthApp.listForUser(context.userId!);
    return {
      apps: apps.map((a) => ({
        clientId: a.clientId,
        name: a.name,
        host: a.host,
        verifiedAs: a.verifiedAs,
        label: a.label,
        scopes: a.scopes,
        connectedAt: a.connectedAt,
        lastAuthorizedAt: a.lastAuthorizedAt,
      })),
    };
  }),

  /** Disconnects an app: removes consent and revokes its tokens immediately. */
  revoke: authed
    .input(z.object({ clientId: z.string().min(1) }))
    .handler(async ({ context, input }) => {
      const revoked = await oauthApp.revokeForUser(context.userId!, input.clientId);
      if (!revoked) throw new ORPCError("NOT_FOUND", { message: "App not connected" });
      return {};
    }),

  /**
   * Verified details for the consent screen. The signed query proves the
   * client_id, scopes and redirect_uri come from the authorize request.
   */
  consentContext: authed
    .input(z.object({ oauthQuery: z.string().min(1).max(8000) }))
    .handler(async ({ input }) => {
      const query = signedQuery(input.oauthQuery);
      const { secret } = await auth.$context;
      if (!(await verifyOAuthQueryParams(query.toString(), secret))) {
        throw new ORPCError("BAD_REQUEST", {
          message: "This sign-in link has expired. Go back to the app and try connecting again.",
        });
      }
      const clientId = query.get("client_id");
      if (!clientId) throw new ORPCError("BAD_REQUEST", { message: "Missing client" });
      const client = await oauthApp.getClient(clientId);
      if (!client || client.disabled) {
        throw new ORPCError("NOT_FOUND", { message: "This app is not registered with Tab" });
      }
      const redirectUri = query.get("redirect_uri");
      // Verification looks at every registered redirect URI, not just this one.
      const display = describeOAuthClient({
        clientId,
        name: client.name,
        redirectUris: client.redirectUris,
      });
      const scopes = (query.get("scope") ?? "").split(" ").filter(Boolean);
      return {
        client: {
          clientId,
          name: display.name,
          // Where this response actually goes, unless the client_id itself is a domain.
          host: display.verifiedAs ? display.host : (display.host ?? hostOf(redirectUri)),
          verifiedAs: display.verifiedAs,
          uri: httpsOrNull(client.uri),
        },
        redirectHost: hostOf(redirectUri) ?? redirectUri,
        scopes: scopes.map((s) => ({ scope: s, description: MCP_SCOPE_DESCRIPTIONS[s] ?? s })),
      };
    }),
};
