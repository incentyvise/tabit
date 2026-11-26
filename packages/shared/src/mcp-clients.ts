/**
 * Hosts of well-known MCP clients. A client whose CIMD `client_id` or
 * redirect URI lives on one of these hosts gets a verified mark in the UI.
 */
export const KNOWN_MCP_CLIENT_HOSTS: Record<string, string> = {
  "claude.ai": "Claude",
  "claude.com": "Claude",
  "anthropic.com": "Claude",
  "chatgpt.com": "ChatGPT",
  "openai.com": "ChatGPT",
  "cursor.com": "Cursor",
  "cursor.sh": "Cursor",
  "vscode.dev": "VS Code",
};

export function knownClientForHost(host: string | null | undefined): string | null {
  if (!host) return null;
  const h = host.toLowerCase();
  for (const [known, name] of Object.entries(KNOWN_MCP_CLIENT_HOSTS)) {
    if (h === known || h.endsWith(`.${known}`)) return name;
  }
  return null;
}

export function hostOf(uri: string | null | undefined): string | null {
  if (!uri) return null;
  try {
    const u = new URL(uri);
    return u.protocol === "http:" || u.protocol === "https:" ? u.host : null;
  } catch {
    return null;
  }
}

export type OAuthClientDisplay = {
  /** Name the client gave itself (unverified). */
  name: string;
  /**
   * Host that identifies the client: its CIMD `client_id` host, else the host
   * all of its redirect URIs share (null when they point at different hosts).
   */
  host: string | null;
  /**
   * Set only when the client provably belongs to a well-known MCP client: its
   * CIMD `client_id` is on that client's domain, or every registered redirect
   * URI is (so authorization codes can only ever be delivered there).
   */
  verifiedAs: string | null;
  /**
   * Safe label for UI, ledger rows and other people's notifications: the
   * verified name, or the self-declared name qualified by its host.
   */
  label: string;
};

/** The client_id host for CIMD clients (their client_id is an HTTPS URL). */
function cimdHost(clientId: string): string | null {
  try {
    const u = new URL(clientId);
    return u.protocol === "https:" ? u.host : null;
  } catch {
    return null;
  }
}

/**
 * How to present an OAuth client. Names are self-declared by whoever
 * registered the client (DCR is unauthenticated), so a name is only trusted
 * when the client is bound to a known domain; otherwise it is always shown
 * together with a host the client can't fake.
 */
export function describeOAuthClient(client: {
  clientId: string;
  name?: string | null;
  redirectUris?: readonly string[] | null;
}): OAuthClientDisplay {
  const fromCimd = cimdHost(client.clientId);
  const redirectHosts = [...new Set((client.redirectUris ?? []).map((u) => hostOf(u)))];
  const sharedRedirectHost =
    redirectHosts.length === 1 && redirectHosts[0] ? redirectHosts[0] : null;

  let verifiedAs: string | null = null;
  if (fromCimd) {
    verifiedAs = knownClientForHost(fromCimd);
  } else if (redirectHosts.length > 0 && redirectHosts.every((h) => h !== null)) {
    const names = new Set(redirectHosts.map((h) => knownClientForHost(h)));
    const only = names.size === 1 ? [...names][0] : null;
    verifiedAs = only ?? null;
  }

  const host = fromCimd ?? sharedRedirectHost;
  const name = client.name?.trim() || verifiedAs || host || "MCP client";
  const label = verifiedAs
    ? verifiedAs
    : host
      ? `${name} (${host})`
      : `${name} (unverified)`;
  return { name, host, verifiedAs, label };
}
