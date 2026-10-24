import { db, aiUsageEvent, apiKey } from "db";
import { eq, sql, type SQL } from "drizzle-orm";

/** Read-only queries backing the admin console. Raw SQL for aggregates; identifiers are camelCase so quoted. */

// drizzle's pg driver returns `timestamp` columns from raw queries as zone-less strings; they're stored as
// UTC (same assumption drizzle makes for typed selects), so parse them back into Dates.
const PG_TIMESTAMP = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}(\.\d+)?$/;

function reviveTimestamps(row: Record<string, unknown>): Record<string, unknown> {
  for (const [key, value] of Object.entries(row)) {
    if (typeof value === "string" && PG_TIMESTAMP.test(value)) {
      row[key] = new Date(`${value.replace(" ", "T")}Z`);
    }
  }
  return row;
}

async function rows<T>(query: SQL): Promise<T[]> {
  const result = await db.execute(query);
  return (result.rows as Record<string, unknown>[]).map(reviveTimestamps) as T[];
}

async function one<T>(query: SQL): Promise<T> {
  const [row] = await rows<T>(query);
  return row as T;
}

function like(q: string): string {
  return `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
}

/** Unified audit rows from expense_audit_log, settlement_audit_log and tab_event. */
const AUDIT_UNION = sql`
  SELECT 'expense' AS "source", a."id", a."action", a."tabId", a."expenseId" AS "entityId",
         a."performedById" AS "userId", a."performedAt" AS "at", a."changes" AS "details"
    FROM "expense_audit_log" a
  UNION ALL
  SELECT 'settlement', s."id", s."action", s."tabId", s."settlementId",
         s."performedById", s."performedAt", s."changes"
    FROM "settlement_audit_log" s
  UNION ALL
  SELECT 'tab', e."id", e."type", e."tabId", e."tabId",
         e."performedByUserId", e."createdAt", e."payload"
    FROM "tab_event" e
`;

export type AdminAuditRow = {
  source: "expense" | "settlement" | "tab";
  id: string;
  action: string;
  tabId: string;
  tabName: string | null;
  entityId: string;
  userId: string;
  userName: string | null;
  userEmail: string | null;
  at: Date;
  details: unknown;
};

export type AdminUserListItem = {
  id: string;
  name: string | null;
  username: string | null;
  email: string;
  image: string | null;
  role: string | null;
  banned: boolean | null;
  createdAt: Date;
  lastSeenAt: Date | null;
  tabCount: number;
  expenseCount: number;
};

export type AdminTabListItem = {
  id: string;
  name: string;
  isDirect: boolean;
  currency: string;
  createdAt: Date;
  memberNames: string | null;
  memberCount: number;
  placeholderCount: number;
  expenseCount: number;
  volume: number;
  lastActivityAt: Date | null;
};

export type AdminExpenseListItem = {
  id: string;
  tabId: string;
  tabName: string;
  isDirect: boolean;
  description: string;
  amount: number;
  originalAmount: number;
  currency: string;
  tabCurrency: string;
  splitType: string;
  expenseDate: Date;
  createdAt: Date;
  deletedAt: Date | null;
  recurringRuleId: string | null;
  paidByName: string | null;
};

type Paged<T> = { items: T[]; total: number };

export const admin = {
  overview: async () => {
    const [counts, funnel, recentSignups, volumeByCurrency] = await Promise.all([
      one<Record<string, number>>(sql`
        SELECT
          (SELECT count(*)::int FROM "user") AS "users",
          (SELECT count(*)::int FROM "user" WHERE "createdAt" > now() - interval '1 day') AS "newUsers1d",
          (SELECT count(*)::int FROM "user" WHERE "createdAt" > now() - interval '7 days') AS "newUsers7d",
          (SELECT count(*)::int FROM "user" WHERE "createdAt" > now() - interval '30 days') AS "newUsers30d",
          (SELECT count(*)::int FROM "user" WHERE "banned" = true) AS "bannedUsers",
          (SELECT count(DISTINCT "performedById")::int FROM (
             SELECT "performedById", "performedAt" FROM "expense_audit_log"
             UNION ALL SELECT "performedById", "performedAt" FROM "settlement_audit_log"
           ) x WHERE "performedAt" > now() - interval '7 days') AS "activeUsers7d",
          (SELECT count(DISTINCT "performedById")::int FROM (
             SELECT "performedById", "performedAt" FROM "expense_audit_log"
             UNION ALL SELECT "performedById", "performedAt" FROM "settlement_audit_log"
           ) x WHERE "performedAt" > now() - interval '30 days') AS "activeUsers30d",
          (SELECT count(DISTINCT "userId")::int FROM "session" WHERE "updatedAt" > now() - interval '7 days') AS "seenUsers7d",
          (SELECT count(*)::int FROM "tab") AS "tabs",
          (SELECT count(*)::int FROM "tab" WHERE "isDirect" = false) AS "groupTabs",
          (SELECT count(*)::int FROM "tab" WHERE "createdAt" > now() - interval '7 days') AS "newTabs7d",
          (SELECT count(*)::int FROM "expense" WHERE "deletedAt" IS NULL) AS "expenses",
          (SELECT count(*)::int FROM "expense" WHERE "deletedAt" IS NULL AND "createdAt" > now() - interval '7 days') AS "expenses7d",
          (SELECT count(*)::int FROM "settlement") AS "settlements",
          (SELECT count(*)::int FROM "recurring_expense_rule" WHERE "status" = 'active') AS "activeRecurringRules",
          (SELECT count(*)::int FROM "push_subscription") AS "pushSubscriptions",
          (SELECT count(DISTINCT "userId")::int FROM "push_subscription") AS "pushUsers",
          (SELECT count(*)::int FROM "ai_usage_event" WHERE "createdAt" > now() - interval '7 days') AS "aiCalls7d"
      `),
      one<Record<string, number>>(sql`
        SELECT
          (SELECT count(*)::int FROM "user") AS "signedUp",
          (SELECT count(*)::int FROM "user" WHERE "username" IS NOT NULL) AS "profileComplete",
          (SELECT count(DISTINCT "userId")::int FROM "tab_member") AS "joinedTab",
          (SELECT count(*)::int FROM (
             SELECT "performedById" FROM "expense_audit_log" WHERE "action" = 'create'
             GROUP BY 1) x) AS "firstExpense",
          (SELECT count(*)::int FROM (
             SELECT "performedById" FROM "expense_audit_log" WHERE "action" = 'create'
             GROUP BY 1 HAVING count(*) >= 5) x) AS "fiveExpenses",
          (SELECT count(DISTINCT "performedById")::int FROM "settlement_audit_log") AS "settledUp"
      `),
      rows<{ id: string; name: string | null; email: string; username: string | null; createdAt: Date }>(sql`
        SELECT "id", "name", "email", "username", "createdAt" FROM "user"
        ORDER BY "createdAt" DESC LIMIT 10
      `),
      rows<{ currency: string; count: number; total: number }>(sql`
        SELECT "currency", count(*)::int AS "count", sum("originalAmount")::float8 AS "total"
          FROM "expense" WHERE "deletedAt" IS NULL
         GROUP BY 1 ORDER BY 2 DESC LIMIT 8
      `),
    ]);
    return { counts, funnel, recentSignups, volumeByCurrency };
  },

  timeseries: async (days: number) => {
    return rows<{
      day: string;
      signups: number;
      expenses: number;
      settlements: number;
      activeUsers: number;
      tabs: number;
    }>(sql`
      WITH days AS (
        SELECT generate_series(current_date - (${days}::int - 1), current_date, interval '1 day')::date AS "day"
      )
      SELECT to_char(d."day", 'YYYY-MM-DD') AS "day",
        (SELECT count(*)::int FROM "user" u WHERE u."createdAt"::date = d."day") AS "signups",
        (SELECT count(*)::int FROM "expense" e WHERE e."createdAt"::date = d."day") AS "expenses",
        (SELECT count(*)::int FROM "settlement" s WHERE s."createdAt"::date = d."day") AS "settlements",
        (SELECT count(*)::int FROM "tab" t WHERE t."createdAt"::date = d."day") AS "tabs",
        (SELECT count(DISTINCT x."performedById")::int FROM (
           SELECT "performedById", "performedAt" FROM "expense_audit_log"
           UNION ALL SELECT "performedById", "performedAt" FROM "settlement_audit_log"
         ) x WHERE x."performedAt"::date = d."day") AS "activeUsers"
      FROM days d ORDER BY d."day"
    `);
  },

  listUsers: async (opts: {
    search?: string;
    filter?: "all" | "admins" | "banned";
    sort?: "createdAt" | "lastSeenAt" | "expenseCount" | "name";
    limit: number;
    offset: number;
  }): Promise<Paged<AdminUserListItem>> => {
    const conditions: SQL[] = [sql`true`];
    if (opts.search) {
      const q = like(opts.search);
      conditions.push(
        sql`(u."email" ILIKE ${q} OR u."name" ILIKE ${q} OR u."username" ILIKE ${q} OR u."id" = ${opts.search})`,
      );
    }
    if (opts.filter === "admins") conditions.push(sql`u."role" = 'admin'`);
    if (opts.filter === "banned") conditions.push(sql`u."banned" = true`);
    const where = sql.join(conditions, sql` AND `);
    const orderBy = {
      createdAt: sql`u."createdAt" DESC`,
      lastSeenAt: sql`"lastSeenAt" DESC NULLS LAST`,
      expenseCount: sql`"expenseCount" DESC`,
      name: sql`lower(coalesce(u."name", u."email")) ASC`,
    }[opts.sort ?? "createdAt"];

    const [items, total] = await Promise.all([
      rows<AdminUserListItem>(sql`
        SELECT u."id", u."name", u."username", u."email", u."image", u."role", u."banned", u."createdAt",
          (SELECT max(s."updatedAt") FROM "session" s WHERE s."userId" = u."id") AS "lastSeenAt",
          (SELECT count(*)::int FROM "tab_member" m WHERE m."userId" = u."id") AS "tabCount",
          (SELECT count(*)::int FROM "expense_audit_log" a WHERE a."performedById" = u."id" AND a."action" = 'create') AS "expenseCount"
        FROM "user" u WHERE ${where}
        ORDER BY ${orderBy} LIMIT ${opts.limit} OFFSET ${opts.offset}
      `),
      one<{ total: number }>(sql`SELECT count(*)::int AS "total" FROM "user" u WHERE ${where}`),
    ]);
    return { items, total: total.total };
  },

  getUser: async (userId: string) => {
    const user = await one<
      | (AdminUserListItem & {
          emailVerified: boolean;
          defaultCurrency: string | null;
          timezone: string | null;
          banReason: string | null;
          banExpires: Date | null;
          updatedAt: Date;
        })
      | undefined
    >(sql`
      SELECT u.*,
        (SELECT max(s."updatedAt") FROM "session" s WHERE s."userId" = u."id") AS "lastSeenAt",
        (SELECT count(*)::int FROM "tab_member" m WHERE m."userId" = u."id") AS "tabCount",
        (SELECT count(*)::int FROM "expense_audit_log" a WHERE a."performedById" = u."id" AND a."action" = 'create') AS "expenseCount"
      FROM "user" u WHERE u."id" = ${userId}
    `);
    if (!user) return null;

    const [stats, tabs, sessions, apiKeys, pushSubscriptions, preferences, activity, ai] =
      await Promise.all([
        one<Record<string, number>>(sql`
          SELECT
            (SELECT count(*)::int FROM "settlement_audit_log" WHERE "performedById" = ${userId}) AS "settlementsRecorded",
            (SELECT count(*)::int FROM "tab_member" m JOIN "tab" t ON t."id" = m."tabId"
              WHERE m."userId" = ${userId} AND t."isDirect" = true) AS "friends",
            (SELECT count(*)::int FROM "tab_member" m JOIN "tab" t ON t."id" = m."tabId"
              WHERE m."userId" = ${userId} AND t."isDirect" = false) AS "groupTabs",
            (SELECT count(*)::int FROM "recurring_expense_rule" WHERE "ownerUserId" = ${userId}) AS "recurringRules",
            (SELECT count(*)::int FROM "ai_usage_event" WHERE "userId" = ${userId}) AS "aiCalls",
            (SELECT count(*)::int FROM "friend_request" WHERE "toUserId" = ${userId} AND "status" = 'pending') AS "pendingFriendRequests"
        `),
        rows<{
          id: string;
          name: string;
          isDirect: boolean;
          currency: string;
          role: string;
          createdAt: Date;
          memberNames: string | null;
          expenseCount: number;
        }>(sql`
          SELECT t."id", t."name", t."isDirect", t."currency", m."role", t."createdAt",
            (SELECT string_agg(coalesce(ou."name", ou."email"), ', ') FROM "tab_member" om
               JOIN "user" ou ON ou."id" = om."userId" WHERE om."tabId" = t."id" AND om."userId" <> ${userId}) AS "memberNames",
            (SELECT count(*)::int FROM "expense" e WHERE e."tabId" = t."id" AND e."deletedAt" IS NULL) AS "expenseCount"
          FROM "tab_member" m JOIN "tab" t ON t."id" = m."tabId"
          WHERE m."userId" = ${userId} ORDER BY t."createdAt" DESC
        `),
        rows<{
          id: string;
          ipAddress: string | null;
          userAgent: string | null;
          createdAt: Date;
          updatedAt: Date;
          expiresAt: Date;
          impersonatedBy: string | null;
          token: string;
        }>(sql`
          SELECT "id", "token", "ipAddress", "userAgent", "createdAt", "updatedAt", "expiresAt", "impersonatedBy"
            FROM "session" WHERE "userId" = ${userId} ORDER BY "updatedAt" DESC
        `),
        db
          .select({
            id: apiKey.id,
            name: apiKey.name,
            keyPrefix: apiKey.keyPrefix,
            scopes: apiKey.scopes,
            createdAt: apiKey.createdAt,
            expiresAt: apiKey.expiresAt,
          })
          .from(apiKey)
          .where(eq(apiKey.userId, userId)),
        rows<{ id: string; endpoint: string; userAgent: string | null; createdAt: Date }>(sql`
          SELECT "id", "endpoint", "userAgent", "createdAt" FROM "push_subscription"
           WHERE "userId" = ${userId} ORDER BY "createdAt" DESC
        `),
        rows<{ key: string; value: string; updatedAt: Date }>(sql`
          SELECT "key", "value", "updatedAt" FROM "user_preference" WHERE "userId" = ${userId} ORDER BY "key"
        `),
        admin.audit({ userId, limit: 50, offset: 0 }),
        rows<{
          id: string;
          outcome: string;
          inputChars: number;
          latencyMs: number;
          confidence: string | null;
          errorMessage: string | null;
          createdAt: Date;
        }>(sql`
          SELECT "id", "outcome", "inputChars", "latencyMs", "confidence", "errorMessage", "createdAt"
            FROM "ai_usage_event" WHERE "userId" = ${userId} ORDER BY "createdAt" DESC LIMIT 20
        `),
      ]);

    return {
      user,
      stats,
      tabs,
      // Tokens identify sessions for revoke; never send the full value to the client.
      sessions: sessions.map(({ token, ...s }) => ({ ...s, tokenPreview: token.slice(0, 6) })),
      apiKeys,
      pushSubscriptions: pushSubscriptions.map((p) => ({
        ...p,
        endpointHost: safeHost(p.endpoint),
        endpoint: undefined,
      })),
      preferences,
      activity: activity.items,
      ai,
    };
  },

  /** Raw session token by id (for revoking via Better Auth). */
  getSessionToken: async (sessionId: string): Promise<{ token: string; userId: string } | null> => {
    const row = await one<{ token: string; userId: string } | undefined>(sql`
      SELECT "token", "userId" FROM "session" WHERE "id" = ${sessionId}
    `);
    return row ?? null;
  },

  setRole: async (userId: string, role: "admin" | "user"): Promise<void> => {
    await db.execute(sql`UPDATE "user" SET "role" = ${role}, "updatedAt" = now() WHERE "id" = ${userId}`);
  },

  deleteApiKey: async (id: string): Promise<boolean> => {
    const deleted = await db.delete(apiKey).where(eq(apiKey.id, id)).returning({ id: apiKey.id });
    return deleted.length > 0;
  },

  listTabs: async (opts: {
    search?: string;
    type?: "all" | "group" | "direct";
    sort?: "createdAt" | "lastActivityAt" | "expenseCount" | "volume";
    limit: number;
    offset: number;
  }): Promise<Paged<AdminTabListItem>> => {
    const conditions: SQL[] = [sql`true`];
    if (opts.search) {
      const q = like(opts.search);
      conditions.push(sql`(t."name" ILIKE ${q} OR t."id" = ${opts.search} OR EXISTS (
        SELECT 1 FROM "tab_member" m JOIN "user" u ON u."id" = m."userId"
         WHERE m."tabId" = t."id" AND (u."email" ILIKE ${q} OR u."name" ILIKE ${q} OR u."username" ILIKE ${q})))`);
    }
    if (opts.type === "group") conditions.push(sql`t."isDirect" = false`);
    if (opts.type === "direct") conditions.push(sql`t."isDirect" = true`);
    const where = sql.join(conditions, sql` AND `);
    const orderBy = {
      createdAt: sql`t."createdAt" DESC`,
      lastActivityAt: sql`"lastActivityAt" DESC NULLS LAST`,
      expenseCount: sql`"expenseCount" DESC`,
      volume: sql`"volume" DESC`,
    }[opts.sort ?? "createdAt"];

    const [items, total] = await Promise.all([
      rows<AdminTabListItem>(sql`
        SELECT t."id", t."name", t."isDirect", t."currency", t."createdAt",
          (SELECT string_agg(coalesce(u."name", u."email"), ', ') FROM "tab_member" m
             JOIN "user" u ON u."id" = m."userId" WHERE m."tabId" = t."id") AS "memberNames",
          (SELECT count(*)::int FROM "tab_member" m WHERE m."tabId" = t."id") AS "memberCount",
          (SELECT count(*)::int FROM "tab_participant" p WHERE p."tabId" = t."id" AND p."kind" = 'placeholder' AND p."mergedAt" IS NULL) AS "placeholderCount",
          (SELECT count(*)::int FROM "expense" e WHERE e."tabId" = t."id" AND e."deletedAt" IS NULL) AS "expenseCount",
          coalesce((SELECT sum(e."amount")::float8 FROM "expense" e WHERE e."tabId" = t."id" AND e."deletedAt" IS NULL), 0) AS "volume",
          greatest(
            (SELECT max(e."createdAt") FROM "expense" e WHERE e."tabId" = t."id"),
            (SELECT max(s."createdAt") FROM "settlement" s WHERE s."tabId" = t."id")
          ) AS "lastActivityAt"
        FROM "tab" t WHERE ${where}
        ORDER BY ${orderBy} LIMIT ${opts.limit} OFFSET ${opts.offset}
      `),
      one<{ total: number }>(sql`SELECT count(*)::int AS "total" FROM "tab" t WHERE ${where}`),
    ]);
    return { items, total: total.total };
  },

  getTab: async (tabId: string) => {
    const tab = await one<
      { id: string; name: string; isDirect: boolean; currency: string; createdAt: Date } | undefined
    >(sql`SELECT "id", "name", "isDirect", "currency", "createdAt" FROM "tab" WHERE "id" = ${tabId}`);
    if (!tab) return null;

    const [members, participants, expenses, settlements, recurringRules, invites, audit, totals] =
      await Promise.all([
        rows<{ userId: string; role: string; name: string | null; email: string; username: string | null }>(sql`
          SELECT m."userId", m."role", u."name", u."email", u."username"
            FROM "tab_member" m JOIN "user" u ON u."id" = m."userId"
           WHERE m."tabId" = ${tabId} ORDER BY m."role", u."name"
        `),
        rows<{
          id: string;
          kind: string;
          userId: string | null;
          displayName: string;
          mergedIntoParticipantId: string | null;
          mergedAt: Date | null;
          createdAt: Date;
        }>(sql`
          SELECT "id", "kind", "userId", "displayName", "mergedIntoParticipantId", "mergedAt", "createdAt"
            FROM "tab_participant" WHERE "tabId" = ${tabId} ORDER BY "createdAt"
        `),
        admin.listExpenses({ tabId, includeDeleted: true, limit: 200, offset: 0 }),
        rows<{
          id: string;
          amount: number;
          currency: string | null;
          originalAmount: number | null;
          settlementDate: Date;
          createdAt: Date;
          fromName: string | null;
          toName: string | null;
        }>(sql`
          SELECT s."id", s."amount"::float8 AS "amount", s."currency", s."originalAmount"::float8 AS "originalAmount",
                 s."settlementDate", s."createdAt",
                 coalesce(fu."name", fu."email", fp."displayName") AS "fromName",
                 coalesce(tu."name", tu."email", tp."displayName") AS "toName"
            FROM "settlement" s
            LEFT JOIN "user" fu ON fu."id" = s."fromUserId"
            LEFT JOIN "user" tu ON tu."id" = s."toUserId"
            LEFT JOIN "tab_participant" fp ON fp."id" = s."fromParticipantId"
            LEFT JOIN "tab_participant" tp ON tp."id" = s."toParticipantId"
           WHERE s."tabId" = ${tabId} ORDER BY s."settlementDate" DESC LIMIT 200
        `),
        admin.listRecurringRules({ tabId }),
        rows<{ kind: string; id: string; createdAt: Date; expiresAt: Date | null; fromName: string | null; toName: string | null }>(sql`
          SELECT 'link' AS "kind", i."id", i."createdAt", i."expiresAt", coalesce(u."name", u."email") AS "fromName", NULL AS "toName"
            FROM "pending_tab_invite" i JOIN "user" u ON u."id" = i."createdByUserId"
           WHERE i."tabId" = ${tabId} AND i."expiresAt" > now()
          UNION ALL
          SELECT 'request', r."id", r."createdAt", NULL, coalesce(fu."name", fu."email"), coalesce(tu."name", tu."email")
            FROM "tab_invite_request" r
            JOIN "user" fu ON fu."id" = r."fromUserId" JOIN "user" tu ON tu."id" = r."toUserId"
           WHERE r."tabId" = ${tabId} AND r."status" = 'pending'
        `),
        admin.audit({ tabId, limit: 100, offset: 0 }),
        one<{ expenseVolume: number; settlementVolume: number; deletedExpenses: number }>(sql`
          SELECT
            coalesce((SELECT sum("amount")::float8 FROM "expense" WHERE "tabId" = ${tabId} AND "deletedAt" IS NULL), 0) AS "expenseVolume",
            coalesce((SELECT sum("amount")::float8 FROM "settlement" WHERE "tabId" = ${tabId}), 0) AS "settlementVolume",
            (SELECT count(*)::int FROM "expense" WHERE "tabId" = ${tabId} AND "deletedAt" IS NOT NULL) AS "deletedExpenses"
        `),
      ]);

    return {
      tab,
      totals,
      members,
      participants,
      expenses: expenses.items,
      settlements,
      recurringRules,
      invites,
      audit: audit.items,
    };
  },

  listExpenses: async (opts: {
    search?: string;
    tabId?: string;
    userId?: string;
    includeDeleted?: boolean;
    limit: number;
    offset: number;
  }): Promise<Paged<AdminExpenseListItem>> => {
    const conditions: SQL[] = [sql`true`];
    if (opts.search) {
      conditions.push(sql`(e."description" ILIKE ${like(opts.search)} OR e."id" = ${opts.search})`);
    }
    if (opts.tabId) conditions.push(sql`e."tabId" = ${opts.tabId}`);
    if (opts.userId) {
      conditions.push(sql`(e."paidById" = ${opts.userId} OR EXISTS (
        SELECT 1 FROM "expense_split" sp WHERE sp."expenseId" = e."id" AND sp."userId" = ${opts.userId}))`);
    }
    if (!opts.includeDeleted) conditions.push(sql`e."deletedAt" IS NULL`);
    const where = sql.join(conditions, sql` AND `);

    const [items, total] = await Promise.all([
      rows<AdminExpenseListItem>(sql`
        SELECT e."id", e."tabId", t."name" AS "tabName", t."isDirect", e."description",
               e."amount"::float8 AS "amount", e."originalAmount"::float8 AS "originalAmount",
               e."currency", t."currency" AS "tabCurrency", e."splitType", e."expenseDate", e."createdAt",
               e."deletedAt", e."recurringRuleId",
               coalesce(u."name", u."email", p."displayName") AS "paidByName"
          FROM "expense" e
          JOIN "tab" t ON t."id" = e."tabId"
          LEFT JOIN "user" u ON u."id" = e."paidById"
          LEFT JOIN "tab_participant" p ON p."id" = e."paidByParticipantId"
         WHERE ${where}
         ORDER BY e."createdAt" DESC LIMIT ${opts.limit} OFFSET ${opts.offset}
      `),
      one<{ total: number }>(sql`SELECT count(*)::int AS "total" FROM "expense" e WHERE ${where}`),
    ]);
    return { items, total: total.total };
  },

  getExpense: async (expenseId: string) => {
    const [list, splits, audit, reactions] = await Promise.all([
      admin.listExpenses({ search: expenseId, includeDeleted: true, limit: 1, offset: 0 }),
      rows<{ id: string; amount: number; weight: string | null; name: string | null; userId: string | null }>(sql`
        SELECT sp."id", sp."amount"::float8 AS "amount", sp."weight", sp."userId",
               coalesce(u."name", u."email", p."displayName") AS "name"
          FROM "expense_split" sp
          LEFT JOIN "user" u ON u."id" = sp."userId"
          LEFT JOIN "tab_participant" p ON p."id" = sp."participantId"
         WHERE sp."expenseId" = ${expenseId} ORDER BY sp."amount" DESC
      `),
      rows<{ id: string; action: string; at: Date; changes: unknown; userName: string | null }>(sql`
        SELECT a."id", a."action", a."performedAt" AS "at", a."changes", coalesce(u."name", u."email") AS "userName"
          FROM "expense_audit_log" a LEFT JOIN "user" u ON u."id" = a."performedById"
         WHERE a."expenseId" = ${expenseId} ORDER BY a."performedAt"
      `),
      rows<{ emoji: string; name: string | null }>(sql`
        SELECT r."emoji", coalesce(u."name", u."email") AS "name"
          FROM "expense_reaction" r JOIN "user" u ON u."id" = r."userId" WHERE r."expenseId" = ${expenseId}
      `),
    ]);
    const expense = list.items.find((e) => e.id === expenseId);
    if (!expense) return null;
    return { expense, splits, audit, reactions };
  },

  audit: async (opts: {
    source?: "expense" | "settlement" | "tab";
    action?: string;
    userId?: string;
    tabId?: string;
    from?: Date;
    to?: Date;
    limit: number;
    offset: number;
  }): Promise<Paged<AdminAuditRow>> => {
    const conditions: SQL[] = [sql`true`];
    if (opts.source) conditions.push(sql`x."source" = ${opts.source}`);
    if (opts.action) conditions.push(sql`x."action" = ${opts.action}`);
    if (opts.userId) conditions.push(sql`x."userId" = ${opts.userId}`);
    if (opts.tabId) conditions.push(sql`x."tabId" = ${opts.tabId}`);
    if (opts.from) conditions.push(sql`x."at" >= ${opts.from}`);
    if (opts.to) conditions.push(sql`x."at" <= ${opts.to}`);
    const where = sql.join(conditions, sql` AND `);

    const [items, total] = await Promise.all([
      rows<AdminAuditRow>(sql`
        SELECT x.*, t."name" AS "tabName", u."name" AS "userName", u."email" AS "userEmail"
          FROM (${AUDIT_UNION}) x
          LEFT JOIN "tab" t ON t."id" = x."tabId"
          LEFT JOIN "user" u ON u."id" = x."userId"
         WHERE ${where}
         ORDER BY x."at" DESC LIMIT ${opts.limit} OFFSET ${opts.offset}
      `),
      one<{ total: number }>(sql`SELECT count(*)::int AS "total" FROM (${AUDIT_UNION}) x WHERE ${where}`),
    ]);
    return { items, total: total.total };
  },

  auditActions: async () => {
    return rows<{ source: string; action: string; count: number }>(sql`
      SELECT "source", "action", count(*)::int AS "count" FROM (${AUDIT_UNION}) x GROUP BY 1, 2 ORDER BY 3 DESC
    `);
  },

  listRecurringRules: async (opts: { tabId?: string; status?: string; overdueOnly?: boolean }) => {
    const conditions: SQL[] = [sql`true`];
    if (opts.tabId) conditions.push(sql`r."tabId" = ${opts.tabId}`);
    if (opts.status) conditions.push(sql`r."status" = ${opts.status}`);
    if (opts.overdueOnly) {
      conditions.push(
        sql`r."status" = 'active' AND r."nextDueKey" < to_char(current_date - 1, 'YYYY-MM-DD')`,
      );
    }
    const where = sql.join(conditions, sql` AND `);
    return rows<{
      id: string;
      tabId: string;
      tabName: string;
      ownerName: string | null;
      ownerUserId: string;
      status: string;
      schedule: unknown;
      template: { description?: string; amount?: number; currency?: string } & Record<string, unknown>;
      startsOn: string;
      endsOn: string | null;
      maxCount: number | null;
      postedCount: number;
      nextDueKey: string;
      pausedAt: Date | null;
      updatedAt: Date;
      lastPostedAt: Date | null;
    }>(sql`
      SELECT r."id", r."tabId", t."name" AS "tabName", coalesce(u."name", u."email") AS "ownerName",
             r."ownerUserId", r."status", r."schedule", r."template", r."startsOn", r."endsOn", r."maxCount",
             r."postedCount", r."nextDueKey", r."pausedAt", r."updatedAt",
             (SELECT max(o."createdAt") FROM "recurring_expense_occurrence" o WHERE o."ruleId" = r."id") AS "lastPostedAt"
        FROM "recurring_expense_rule" r
        JOIN "tab" t ON t."id" = r."tabId"
        JOIN "user" u ON u."id" = r."ownerUserId"
       WHERE ${where}
       ORDER BY r."updatedAt" DESC LIMIT 200
    `);
  },

  recurring: async () => {
    const [byStatus, needsFix, overdue, recentOccurrences, fxSnapshots] = await Promise.all([
      rows<{ status: string; count: number }>(sql`
        SELECT "status", count(*)::int AS "count" FROM "recurring_expense_rule" GROUP BY 1 ORDER BY 2 DESC
      `),
      admin.listRecurringRules({ status: "paused_needs_fix" }),
      admin.listRecurringRules({ overdueOnly: true }),
      rows<{
        id: string;
        ruleId: string;
        occurrenceKey: string;
        expenseId: string | null;
        createdAt: Date;
        tabId: string;
        tabName: string;
        description: string | null;
      }>(sql`
        SELECT o."id", o."ruleId", o."occurrenceKey", o."expenseId", o."createdAt", r."tabId", t."name" AS "tabName",
               r."template"->>'description' AS "description"
          FROM "recurring_expense_occurrence" o
          JOIN "recurring_expense_rule" r ON r."id" = o."ruleId"
          JOIN "tab" t ON t."id" = r."tabId"
         ORDER BY o."createdAt" DESC LIMIT 50
      `),
      rows<{ id: string; rateDate: string; base: string; fetchedAt: Date; currencyCount: number }>(sql`
        SELECT "id", "rateDate", "base", "fetchedAt", (SELECT count(*)::int FROM jsonb_object_keys("rates")) AS "currencyCount"
          FROM "fx_rate_snapshot" ORDER BY "fetchedAt" DESC LIMIT 30
      `),
    ]);
    return { byStatus, needsFix, overdue, recentOccurrences, fxSnapshots };
  },

  pushStats: async () => {
    const [totals, subs] = await Promise.all([
      one<{ subscriptions: number; users: number; new7d: number }>(sql`
        SELECT count(*)::int AS "subscriptions", count(DISTINCT "userId")::int AS "users",
               count(*) FILTER (WHERE "createdAt" > now() - interval '7 days')::int AS "new7d"
          FROM "push_subscription"
      `),
      rows<{ id: string; userId: string; userEmail: string; endpoint: string; userAgent: string | null; createdAt: Date }>(sql`
        SELECT p."id", p."userId", u."email" AS "userEmail", p."endpoint", p."userAgent", p."createdAt"
          FROM "push_subscription" p JOIN "user" u ON u."id" = p."userId"
         ORDER BY p."createdAt" DESC
      `),
    ]);
    const byPlatform = new Map<string, number>();
    const byService = new Map<string, number>();
    for (const s of subs) {
      const platform = classifyUserAgent(s.userAgent);
      byPlatform.set(platform, (byPlatform.get(platform) ?? 0) + 1);
      const host = safeHost(s.endpoint);
      byService.set(host, (byService.get(host) ?? 0) + 1);
    }
    const toList = (m: Map<string, number>) =>
      [...m.entries()].map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count);
    return {
      totals,
      byPlatform: toList(byPlatform),
      byService: toList(byService),
      recent: subs.slice(0, 25).map(({ endpoint, ...s }) => ({
        ...s,
        endpointHost: safeHost(endpoint),
        platform: classifyUserAgent(s.userAgent),
      })),
    };
  },

  aiUsage: async (days: number) => {
    const [totals, daily, topUsers, recent] = await Promise.all([
      one<{
        calls: number;
        success: number;
        lowConfidence: number;
        parseError: number;
        error: number;
        users: number;
        inputTokens: number;
        outputTokens: number;
        p50LatencyMs: number | null;
        p95LatencyMs: number | null;
        avgConfidence: number | null;
      }>(sql`
        SELECT count(*)::int AS "calls",
               count(*) FILTER (WHERE "outcome" = 'success')::int AS "success",
               count(*) FILTER (WHERE "outcome" = 'low_confidence')::int AS "lowConfidence",
               count(*) FILTER (WHERE "outcome" = 'parse_error')::int AS "parseError",
               count(*) FILTER (WHERE "outcome" = 'error')::int AS "error",
               count(DISTINCT "userId")::int AS "users",
               coalesce(sum("inputTokens"), 0)::int AS "inputTokens",
               coalesce(sum("outputTokens"), 0)::int AS "outputTokens",
               percentile_cont(0.5) WITHIN GROUP (ORDER BY "latencyMs")::float8 AS "p50LatencyMs",
               percentile_cont(0.95) WITHIN GROUP (ORDER BY "latencyMs")::float8 AS "p95LatencyMs",
               avg("confidence")::float8 AS "avgConfidence"
          FROM "ai_usage_event" WHERE "createdAt" > now() - make_interval(days => ${days}::int)
      `),
      rows<{ day: string; success: number; failed: number }>(sql`
        WITH days AS (
          SELECT generate_series(current_date - (${days}::int - 1), current_date, interval '1 day')::date AS "day"
        )
        SELECT to_char(d."day", 'YYYY-MM-DD') AS "day",
          count(a."id") FILTER (WHERE a."outcome" = 'success')::int AS "success",
          count(a."id") FILTER (WHERE a."outcome" <> 'success')::int AS "failed"
        FROM days d LEFT JOIN "ai_usage_event" a ON a."createdAt"::date = d."day"
        GROUP BY d."day" ORDER BY d."day"
      `),
      rows<{ userId: string; email: string; name: string | null; calls: number; success: number }>(sql`
        SELECT a."userId", u."email", u."name", count(*)::int AS "calls",
               count(*) FILTER (WHERE a."outcome" = 'success')::int AS "success"
          FROM "ai_usage_event" a JOIN "user" u ON u."id" = a."userId"
         WHERE a."createdAt" > now() - make_interval(days => ${days}::int)
         GROUP BY 1, 2, 3 ORDER BY 4 DESC LIMIT 10
      `),
      db
        .select({
          id: aiUsageEvent.id,
          userId: aiUsageEvent.userId,
          outcome: aiUsageEvent.outcome,
          model: aiUsageEvent.model,
          inputChars: aiUsageEvent.inputChars,
          inputTokens: aiUsageEvent.inputTokens,
          outputTokens: aiUsageEvent.outputTokens,
          latencyMs: aiUsageEvent.latencyMs,
          confidence: aiUsageEvent.confidence,
          expenseId: aiUsageEvent.expenseId,
          errorMessage: aiUsageEvent.errorMessage,
          createdAt: aiUsageEvent.createdAt,
        })
        .from(aiUsageEvent)
        .orderBy(sql`${aiUsageEvent.createdAt} DESC`)
        .limit(50),
    ]);
    return { totals, daily, topUsers, recent };
  },

  recordAiUsage: async (event: typeof aiUsageEvent.$inferInsert): Promise<void> => {
    await db.insert(aiUsageEvent).values(event);
  },

  system: async () => {
    const start = Date.now();
    await db.execute(sql`SELECT 1`);
    const dbLatencyMs = Date.now() - start;
    const [info, tables, migrations] = await Promise.all([
      one<{ version: string; databaseSize: string; connections: number }>(sql`
        SELECT version() AS "version", pg_size_pretty(pg_database_size(current_database())) AS "databaseSize",
               (SELECT count(*)::int FROM pg_stat_activity WHERE datname = current_database()) AS "connections"
      `),
      rows<{ table: string; rows: number; size: string; bytes: number }>(sql`
        SELECT relname AS "table", n_live_tup::int AS "rows",
               pg_size_pretty(pg_total_relation_size(relid)) AS "size",
               pg_total_relation_size(relid)::float8 AS "bytes"
          FROM pg_stat_user_tables ORDER BY pg_total_relation_size(relid) DESC
      `),
      rows<{ id: number; hash: string; createdAt: number }>(sql`
        SELECT id, hash, created_at::float8 AS "createdAt" FROM drizzle.__drizzle_migrations ORDER BY id DESC LIMIT 10
      `).catch((): { id: number; hash: string; createdAt: number }[] => []),
    ]);
    return { dbLatencyMs, ...info, tables, migrations };
  },
};

function safeHost(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return "unknown";
  }
}

function classifyUserAgent(ua: string | null): string {
  if (!ua) return "Unknown";
  if (/iPhone|iPad|iPod/i.test(ua)) return "iOS";
  if (/Android/i.test(ua)) return "Android";
  if (/Macintosh|Mac OS X/i.test(ua)) return "macOS";
  if (/Windows/i.test(ua)) return "Windows";
  if (/Linux|CrOS/i.test(ua)) return "Linux";
  return "Other";
}
