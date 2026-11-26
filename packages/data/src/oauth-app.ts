import {
  db,
  oauthClient,
  oauthConsent,
  oauthRefreshToken,
  oauthAccessToken,
} from "db";
import { and, eq, isNull, max, desc } from "drizzle-orm";
import { describeOAuthClient, type OAuthClientDisplay } from "shared";

export type OAuthClientInfo = OAuthClientDisplay & {
  clientId: string;
  uri: string | null;
  redirectUris: string[];
  disabled: boolean;
};

export type ConnectedApp = OAuthClientInfo & {
  consentId: string;
  scopes: string[];
  connectedAt: Date;
  lastAuthorizedAt: Date | null;
};

function toClientInfo(row: {
  clientId: string;
  name: string | null;
  uri: string | null;
  redirectUris: string[] | null;
  disabled: boolean | null;
}): OAuthClientInfo {
  return {
    ...describeOAuthClient(row),
    clientId: row.clientId,
    uri: row.uri,
    redirectUris: row.redirectUris ?? [],
    disabled: row.disabled ?? false,
  };
}

export const oauthApp = {
  getClient: async (clientId: string): Promise<OAuthClientInfo | null> => {
    const [row] = await db
      .select({
        clientId: oauthClient.clientId,
        name: oauthClient.name,
        uri: oauthClient.uri,
        redirectUris: oauthClient.redirectUris,
        disabled: oauthClient.disabled,
      })
      .from(oauthClient)
      .where(eq(oauthClient.clientId, clientId))
      .limit(1);
    return row ? toClientInfo(row) : null;
  },

  /** True while the user still has a stored consent for this client. */
  hasConsent: async (userId: string, clientId: string): Promise<boolean> => {
    const [row] = await db
      .select({ id: oauthConsent.id })
      .from(oauthConsent)
      .where(and(eq(oauthConsent.userId, userId), eq(oauthConsent.clientId, clientId)))
      .limit(1);
    return !!row;
  },

  /** MCP clients the user has authorized, newest first. */
  listForUser: async (userId: string): Promise<ConnectedApp[]> => {
    const rows = await db
      .select({
        consentId: oauthConsent.id,
        scopes: oauthConsent.scopes,
        connectedAt: oauthConsent.createdAt,
        clientId: oauthClient.clientId,
        name: oauthClient.name,
        uri: oauthClient.uri,
        redirectUris: oauthClient.redirectUris,
        disabled: oauthClient.disabled,
      })
      .from(oauthConsent)
      .innerJoin(oauthClient, eq(oauthClient.clientId, oauthConsent.clientId))
      .where(eq(oauthConsent.userId, userId))
      .orderBy(desc(oauthConsent.createdAt));

    const lastIssued = await db
      .select({ clientId: oauthRefreshToken.clientId, at: max(oauthRefreshToken.createdAt) })
      .from(oauthRefreshToken)
      .where(eq(oauthRefreshToken.userId, userId))
      .groupBy(oauthRefreshToken.clientId);
    const lastByClient = new Map(lastIssued.map((r) => [r.clientId, r.at]));

    return rows.map((r) => ({
      ...toClientInfo(r),
      consentId: r.consentId,
      scopes: r.scopes,
      connectedAt: r.connectedAt,
      lastAuthorizedAt: lastByClient.get(r.clientId) ?? null,
    }));
  },

  /**
   * Disconnects a client: removes the consent (so the MCP endpoint rejects its
   * still-valid JWT access tokens on the next request) and revokes every
   * refresh/opaque access token it holds for this user.
   */
  revokeForUser: async (userId: string, clientId: string): Promise<boolean> => {
    return db.transaction(async (tx) => {
      const now = new Date();
      const deleted = await tx
        .delete(oauthConsent)
        .where(and(eq(oauthConsent.userId, userId), eq(oauthConsent.clientId, clientId)))
        .returning({ id: oauthConsent.id });
      await tx
        .update(oauthRefreshToken)
        .set({ revoked: now })
        .where(
          and(
            eq(oauthRefreshToken.userId, userId),
            eq(oauthRefreshToken.clientId, clientId),
            isNull(oauthRefreshToken.revoked),
          ),
        );
      await tx
        .update(oauthAccessToken)
        .set({ revoked: now })
        .where(
          and(
            eq(oauthAccessToken.userId, userId),
            eq(oauthAccessToken.clientId, clientId),
            isNull(oauthAccessToken.revoked),
          ),
        );
      return deleted.length > 0;
    });
  },
};
