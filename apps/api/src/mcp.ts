import type { Hono } from "hono";
import { cors } from "hono/cors";
import { requireMcpAuth } from "@better-auth/mcp";
import { createMcpHandler, type AuthInfo } from "@modelcontextprotocol/server";
import { auth, getApiBaseUrl, getMcpResource, getPwaUrl, isMcpEnabled, MCP_READ_SCOPE, MCP_WRITE_SCOPE } from "auth";
import { oauthApp, user as userData } from "data";
import { createTabMcpServer } from "mcp";
import { consumeRateLimit } from "queue";
import { log } from "./lib/logger.js";

/** Requests per user per minute on /mcp. Generous for chat use, stops runaway agent loops. */
const MCP_RATE_LIMIT_PER_MIN = (() => {
  const n = Number(process.env.MCP_RATE_LIMIT_PER_MIN);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 120;
})();

type McpAuthExtra = { userId: string; clientName: string };

/**
 * Label stamped on writes ("via MCP · <label>") and shown in other people's
 * notifications. Uses the host-qualified label unless the client is verified,
 * because DCR names are self-declared. Cached briefly; bounded because anyone
 * can register clients.
 */
const CLIENT_LABEL_TTL_MS = 5 * 60_000;
const CLIENT_LABEL_CACHE_MAX = 500;
const clientLabelCache = new Map<string, { label: string; at: number }>();
async function clientLabel(clientId: string): Promise<string> {
  const hit = clientLabelCache.get(clientId);
  if (hit) {
    if (Date.now() - hit.at < CLIENT_LABEL_TTL_MS) return hit.label;
    clientLabelCache.delete(clientId);
  }
  const client = await oauthApp.getClient(clientId);
  const label = client?.label ?? "MCP client (unverified)";
  if (clientLabelCache.size >= CLIENT_LABEL_CACHE_MAX) {
    const oldest = clientLabelCache.keys().next().value;
    if (oldest !== undefined) clientLabelCache.delete(oldest);
  }
  clientLabelCache.set(clientId, { label, at: Date.now() });
  return label;
}

function jsonRpcError(status: number, message: string, headers?: Record<string, string>): Response {
  return new Response(
    JSON.stringify({ jsonrpc: "2.0", error: { code: -32001, message }, id: null }),
    { status, headers: { "content-type": "application/json", ...headers } },
  );
}

/**
 * The OAuth authorize endpoint runs on the API but the user signs in on the
 * PWA. That only works when the session cookie reaches both: same host, or a
 * shared parent domain via BETTER_AUTH_COOKIE_DOMAIN.
 */
function warnIfLoginCannotSeeSession(): void {
  try {
    const apiHost = new URL(getApiBaseUrl()).hostname;
    const pwaHost = new URL(getPwaUrl()).hostname;
    if (apiHost === pwaHost || process.env.BETTER_AUTH_COOKIE_DOMAIN) return;
    log("warn", "MCP sign-in needs a shared cookie domain", {
      apiHost,
      pwaHost,
      hint: "Set BETTER_AUTH_COOKIE_DOMAIN to the parent domain of the API and PWA (e.g. .example.com), or set MCP_ENABLED=false.",
    });
  } catch {
    // malformed URLs are reported elsewhere
  }
}

/**
 * Mounts Tab's MCP server and the OAuth discovery documents MCP clients use
 * to find Better Auth:
 *  - /.well-known/oauth-protected-resource[/mcp]   (RFC 9728, served by mcp())
 *  - /.well-known/oauth-authorization-server/api/auth (RFC 8414)
 *  - /.well-known/openid-configuration/api/auth
 *  - POST /mcp  (MCP Streamable HTTP, stateless)
 *
 * These are called by MCP clients and their backends, not the PWA, so they get
 * an open, credential-less CORS policy instead of the app's allowlist.
 */
export function mountMcp(app: Hono): void {
  if (!isMcpEnabled()) {
    log("info", "MCP disabled (MCP_ENABLED=false)");
    app.all("/api/auth/oauth2/*", (c) => c.json({ error: "MCP is disabled on this server" }, 404));
    return;
  }

  warnIfLoginCannotSeeSession();

  const resource = getMcpResource();
  const resourceMetadataUrl = `${getApiBaseUrl()}/.well-known/oauth-protected-resource/mcp`;

  const openCors = cors({
    origin: "*",
    allowMethods: ["GET", "POST", "OPTIONS"],
    allowHeaders: ["Content-Type", "Authorization", "DPoP", "Mcp-Protocol-Version", "Mcp-Session-Id", "Last-Event-ID"],
    exposeHeaders: ["WWW-Authenticate", "Mcp-Session-Id", "Mcp-Protocol-Version"],
    maxAge: 86400,
  });

  app.use("/.well-known/*", openCors);
  app.use("/mcp", openCors);
  for (const path of ["token", "register", "revoke", "introspect", "userinfo"]) {
    app.use(`/api/auth/oauth2/${path}`, openCors);
  }
  app.use("/api/auth/jwks", openCors);

  app.get("/.well-known/*", (c) => auth.handler(c.req.raw));

  const mcpHandler = createMcpHandler(
    async ({ authInfo }) => {
      const extra = authInfo?.extra as McpAuthExtra | undefined;
      if (!authInfo || !extra?.userId) throw new Error("MCP request reached the server without auth");
      return createTabMcpServer({
        userId: extra.userId,
        clientId: authInfo.clientId,
        clientName: extra.clientName,
        scopes: authInfo.scopes,
      });
    },
    {
      // Serve both 2025 (session-era) clients statelessly and 2026-07-28 clients.
      legacy: "stateless",
      onerror: (error) => log("error", "MCP transport error", { error: error.message }),
    },
  );

  const protectedMcp = requireMcpAuth(
    auth,
    async (request, claims) => {
      const userId = typeof claims.sub === "string" ? claims.sub : null;
      const clientId = typeof claims.azp === "string" ? claims.azp : null;
      if (!userId || !clientId) return jsonRpcError(401, "Invalid access token");

      // Disconnecting an app in Tab deletes its consent; reject its still-valid
      // JWTs right away instead of waiting for them to expire.
      const [hasConsent, account] = await Promise.all([
        oauthApp.hasConsent(userId, clientId),
        userData.getAccessStatus(userId),
      ]);
      if (!hasConsent || account === "missing") {
        return jsonRpcError(401, "This app was disconnected from Tab. Reconnect to continue.", {
          "WWW-Authenticate": `Bearer error="invalid_token", error_description="access revoked", resource_metadata="${resourceMetadataUrl}"`,
        });
      }
      if (account === "banned") {
        return jsonRpcError(403, "This Tab account is suspended.");
      }

      const limit = await consumeRateLimit(`mcp:${userId}`, MCP_RATE_LIMIT_PER_MIN, 60);
      if (!limit.allowed) {
        return jsonRpcError(429, `Too many requests. Try again in ${limit.retryAfterSec}s.`, {
          "Retry-After": String(limit.retryAfterSec),
        });
      }

      const scopes = typeof claims.scope === "string" ? claims.scope.split(" ").filter(Boolean) : [];
      const authInfo: AuthInfo = {
        token: "",
        clientId,
        scopes,
        expiresAt: typeof claims.exp === "number" ? claims.exp : undefined,
        resource: new URL(resource),
        extra: { userId, clientName: await clientLabel(clientId) } satisfies McpAuthExtra,
      };
      return mcpHandler.fetch(request, { authInfo });
    },
    {
      resource,
      requiredScopes: [MCP_READ_SCOPE],
      challengeScopes: [MCP_READ_SCOPE, MCP_WRITE_SCOPE],
    },
  );

  app.all("/mcp", (c) => protectedMcp(c.req.raw));

  log("info", "MCP server mounted", { resource });
}
