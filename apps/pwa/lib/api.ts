import { ORPCError } from "@orpc/client";
import { authClient } from "@/lib/auth-client";
import { orpcClient } from "@/src/lib/orpc-client";

export function getApiUrl(): string {
  const base = import.meta.env.VITE_API_URL;
  return base ?? "http://localhost:3001";
}

function errorMessage(err: unknown): string {
  if (err instanceof ORPCError) return err.message;
  if (err instanceof Error) return err.message;
  return "Request failed";
}

/** HTTP status of a failed call; undefined for transport failures (offline, DNS, CORS, abort). */
function errorStatus(err: unknown): number | undefined {
  return err instanceof ORPCError ? err.status : undefined;
}

async function call<T extends Record<string, unknown>>(
  fn: () => Promise<T>,
): Promise<
  | ({ success: true } & T)
  | { success: false; error: string; status?: number }
> {
  try {
    const data = await fn();
    return { success: true, ...data };
  } catch (err) {
    return { success: false, error: errorMessage(err), status: errorStatus(err) };
  }
}

/**
 * What a successful mutation changed, so the query cache can be brought up to
 * date in one place (see `src/lib/cache-sync.ts`) instead of every call site
 * remembering which keys to invalidate.
 */
export type ApiChange =
  /** Expenses/settlements/members of one tab (balances, lists, summaries). */
  | { kind: "tab"; tabId: string; expenseId?: string; settlementId?: string }
  /** Only an expense's reactions. */
  | { kind: "reaction"; tabId: string; expenseId: string }
  /** The set of tabs changed (a tab was created). */
  | { kind: "tabList" }
  /** Friends, tab invites or tab membership. */
  | { kind: "membership"; tabId?: string }
  | { kind: "recurringRule"; ruleId: string; deleted?: boolean }
  | { kind: "preferences" }
  /** Name/username/currency/timezone: shown across most screens. */
  | { kind: "profile" };

type ChangeListener = (change: ApiChange) => void;
const changeListeners = new Set<ChangeListener>();

export function onApiChange(listener: ChangeListener): () => void {
  changeListeners.add(listener);
  return () => changeListeners.delete(listener);
}

/** `call()` for writes: on success, report what changed. */
async function mutate<T extends Record<string, unknown>>(
  fn: () => Promise<T>,
  change: ApiChange | ((data: T) => ApiChange | null),
): ReturnType<typeof call<T>> {
  const result = await call(fn);
  if (result.success) {
    const c = typeof change === "function" ? change(result as unknown as T) : change;
    if (c) {
      for (const listener of changeListeners) {
        try {
          listener(c);
        } catch {
          // a cache listener must never break the caller
        }
      }
    }
  }
  return result;
}

const membership: ApiChange = { kind: "membership" };

function encodeBase64Url(value: string): string {
  const bytes = new TextEncoder().encode(value);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export const api = {
  friends: {
    getPendingRequests: () =>
      call(() => orpcClient.friends.getPendingRequests()),

    sendRequest: (username: string) =>
      mutate(() => orpcClient.friends.sendRequest({ username }), membership),

    acceptRequest: (requestId: string) =>
      mutate(() => orpcClient.friends.acceptRequest({ requestId }), membership),

    rejectRequest: (requestId: string) =>
      mutate(() => orpcClient.friends.rejectRequest({ requestId }), membership),

    getToken: () => call(() => orpcClient.friends.getToken()),

    addByToken: (token: string) =>
      mutate(() => orpcClient.friends.addByToken({ token }), membership),

    search: (q: string, options?: { includeFriends?: boolean }) =>
      call(() =>
        orpcClient.friends.search({
          q,
          includeFriends: options?.includeFriends,
        }),
      ),

    list: () => call(() => orpcClient.friends.list()),

    poke: (friendTabId: string) =>
      call(() => orpcClient.friends.poke({ friendTabId })),

    sendPaymentReminder: (friendTabId: string, tone: string) =>
      call(() =>
        orpcClient.friends.sendPaymentReminder({
          friendTabId,
          tone: tone as Parameters<
            typeof orpcClient.friends.sendPaymentReminder
          >[0]["tone"],
        }),
      ),
  },

  tabInvites: {
    getByToken: (token: string) =>
      call(() => orpcClient.tabInvites.getByToken({ token })),

    joinByToken: (token: string) =>
      mutate(() => orpcClient.tabInvites.joinByToken({ token }), membership),

    getToken: (tabId: string) =>
      call(() => orpcClient.tabInvites.getToken({ tabId })),

    getPendingRequests: () =>
      call(() => orpcClient.tabInvites.getPendingRequests()),

    sendRequest: (tabId: string, username: string) =>
      mutate(() => orpcClient.tabInvites.sendRequest({ tabId, username }), {
        kind: "membership",
        tabId,
      }),

    acceptRequest: (requestId: string) =>
      mutate(
        () => orpcClient.tabInvites.acceptRequest({ requestId }),
        membership,
      ),

    rejectRequest: (requestId: string) =>
      mutate(
        () => orpcClient.tabInvites.rejectRequest({ requestId }),
        membership,
      ),
  },

  tabs: {
    list: () => call(() => orpcClient.tabs.list()),

    get: (tabId: string) => call(() => orpcClient.tabs.get({ tabId })),

    getBalances: (tabId: string) =>
      call(() => orpcClient.tabs.getBalances({ tabId })),

    getSharedGroupTabs: (tabId: string) =>
      call(() => orpcClient.tabs.getSharedGroupTabs({ tabId })),

    create: (name: string, currency?: string) =>
      mutate(
        () =>
          orpcClient.tabs.create(
            currency !== undefined ? { name, currency } : { name },
          ),
        { kind: "tabList" },
      ),

    update: (tabId: string, updates: { name?: string; currency?: string }) =>
      mutate(() => orpcClient.tabs.update({ tabId, updates }), {
        kind: "tab",
        tabId,
      }),

    addMember: (tabId: string, email: string, role?: string) =>
      mutate(
        () =>
          orpcClient.tabs.addMember({
            tabId,
            body: {
              email,
              role: (role ?? "member") as "owner" | "member",
            },
          }),
        { kind: "membership", tabId },
      ),

    removeMember: (tabId: string, userId: string) =>
      mutate(() => orpcClient.tabs.removeMember({ tabId, userId }), {
        kind: "membership",
        tabId,
      }),

    createPlaceholder: (tabId: string, displayName: string) =>
      mutate(
        () =>
          orpcClient.tabs.createPlaceholder({
            tabId,
            body: { displayName },
          }),
        { kind: "tab", tabId },
      ),

    renamePlaceholder: (
      tabId: string,
      participantId: string,
      displayName: string,
    ) =>
      mutate(
        () =>
          orpcClient.tabs.renamePlaceholder({
            tabId,
            participantId,
            body: { displayName },
          }),
        { kind: "tab", tabId },
      ),

    mergePlaceholder: (
      tabId: string,
      participantId: string,
      targetUserId: string,
    ) =>
      mutate(
        () =>
          orpcClient.tabs.mergePlaceholder({
            tabId,
            participantId,
            body: { targetUserId },
          }),
        { kind: "membership", tabId },
      ),

    listRecurringExpenses: (tabId: string) =>
      call(() => orpcClient.recurringExpenses.listForTab({ tabId })),

    createRecurringExpense: (tabId: string, body: Record<string, unknown>) =>
      mutate(
        () => orpcClient.recurringExpenses.createForTab({ tabId, body }),
        { kind: "tab", tabId },
      ),
  },

  recurringExpenses: {
    get: (ruleId: string) =>
      call(() => orpcClient.recurringExpenses.get({ ruleId })),

    update: (ruleId: string, body: Record<string, unknown>) =>
      mutate(() => orpcClient.recurringExpenses.update({ ruleId, body }), {
        kind: "recurringRule",
        ruleId,
      }),

    delete: (ruleId: string) =>
      mutate(() => orpcClient.recurringExpenses.delete({ ruleId }), {
        kind: "recurringRule",
        ruleId,
        deleted: true,
      }),
  },

  expenses: {
    list: (
      tabId: string,
      options?: {
        limit?: number;
        offset?: number;
        filter?: "all" | "involved" | "owed" | "owe";
        search?: string;
      },
    ) => call(() => orpcClient.expenses.list({ tabId, ...options })),

    get: (tabId: string, expenseId: string) =>
      call(() => orpcClient.expenses.get({ tabId, expenseId })),

    getAuditLog: (tabId: string, expenseId: string) =>
      call(() => orpcClient.expenses.getAuditLog({ tabId, expenseId })),

    fxPreview: (
      tabId: string,
      params: { amount: number; currency: string; expenseDate?: string },
    ) => call(() => orpcClient.expenses.fxPreview({ tabId, ...params })),

    create: (
      tabId: string,
      body: {
        amount: number;
        currency?: string;
        description: string;
        paidById?: string;
        paidByParticipantId?: string;
        splitType?: string;
        participantIds?: string[];
        splits?: { userId: string; amount?: number; weight?: number }[];
        expenseDate?: string | Date;
        createRecurringRule?: Record<string, unknown>;
      },
    ) =>
      mutate(() => orpcClient.expenses.create({ tabId, body }), {
        kind: "tab",
        tabId,
      }),

    createBulk: (
      tabId: string,
      expenses: Array<{
        amount: number;
        currency?: string;
        description: string;
        paidById: string;
        splitType: "equal" | "custom" | "percent" | "shares";
        splits: { userId: string; amount?: number; weight?: number }[];
        expenseDate: string;
        participantIds?: string[];
      }>,
    ) =>
      mutate(() => orpcClient.expenses.createBulk({ tabId, expenses }), {
        kind: "tab",
        tabId,
      }),

    update: (
      tabId: string,
      expenseId: string,
      body: {
        amount?: number;
        currency?: string;
        description?: string;
        paidById?: string;
        paidByParticipantId?: string;
        splitType?: string;
        expenseDate?: string;
        participantIds?: string[];
        splits?: { userId: string; amount?: number; weight?: number }[];
      },
    ) =>
      mutate(() => orpcClient.expenses.update({ tabId, expenseId, body }), {
        kind: "tab",
        tabId,
        expenseId,
      }),

    delete: (tabId: string, expenseId: string) =>
      mutate(() => orpcClient.expenses.delete({ tabId, expenseId }), {
        kind: "tab",
        tabId,
        expenseId,
      }),

    restore: (tabId: string, expenseId: string) =>
      mutate(() => orpcClient.expenses.restore({ tabId, expenseId }), {
        kind: "tab",
        tabId,
        expenseId,
      }),

    addReaction: (tabId: string, expenseId: string, emoji: string) =>
      mutate(
        () => orpcClient.expenses.addReaction({ tabId, expenseId, emoji }),
        { kind: "reaction", tabId, expenseId },
      ),

    removeReaction: (tabId: string, expenseId: string) =>
      mutate(() => orpcClient.expenses.removeReaction({ tabId, expenseId }), {
        kind: "reaction",
        tabId,
        expenseId,
      }),
  },

  settlements: {
    list: (tabId: string) =>
      call(() => orpcClient.tabs.listSettlements({ tabId })),

    get: (tabId: string, settlementId: string) =>
      call(() => orpcClient.tabs.getSettlement({ tabId, settlementId })),

    record: (
      tabId: string,
      body: {
        fromUserId: string | null;
        toUserId: string | null;
        fromParticipantId: string;
        toParticipantId: string;
        amount: number;
        currency?: string;
        originalAmount?: number;
        settlementDate?: string;
      },
    ) =>
      mutate(
        () =>
          orpcClient.tabs.recordSettlement({
            tabId,
            body: { tabId, ...body } as Parameters<
              typeof orpcClient.tabs.recordSettlement
            >[0]["body"],
          }),
        { kind: "tab", tabId },
      ),

    update: (
      tabId: string,
      settlementId: string,
      body: {
        fromUserId: string | null;
        toUserId: string | null;
        fromParticipantId: string;
        toParticipantId: string;
        amount: number;
        currency?: string;
        originalAmount?: number;
        settlementDate?: string;
      },
    ) =>
      mutate(
        () =>
          orpcClient.tabs.updateSettlement({
            tabId,
            settlementId,
            body: body as Parameters<
              typeof orpcClient.tabs.updateSettlement
            >[0]["body"],
          }),
        { kind: "tab", tabId, settlementId },
      ),

    delete: (tabId: string, settlementId: string) =>
      mutate(
        () => orpcClient.tabs.deleteSettlement({ tabId, settlementId }),
        { kind: "tab", tabId, settlementId },
      ),

    getAuditLog: (tabId: string, settlementId: string) =>
      call(() =>
        orpcClient.tabs.getSettlementAuditLog({ tabId, settlementId }),
      ),
  },

  activity: {
    list: (options?: { limit?: number; offset?: number }) =>
      call(() => orpcClient.activity.list(options ?? {})),
  },

  profile: {
    update: (data: {
      name?: string;
      defaultCurrency?: string | null;
      timezone?: string | null;
    }) => mutate(() => orpcClient.profile.update(data), { kind: "profile" }),
  },

  preferences: {
    get: () => call(() => orpcClient.preferences.get()),

    update: (data: {
      addExpensePreference?: "ai" | "manual";
      timezone?: string | null;
    }) =>
      mutate(() => orpcClient.preferences.update(data), {
        kind: "preferences",
      }),
  },

  username: {
    check: async (username: string) => {
      const result = await call(() =>
        orpcClient.username.check({ username }),
      );
      if (!result.success) {
        return { available: null as boolean | null, error: result.error };
      }
      return { available: result.available as boolean, error: undefined };
    },

    update: (username: string) =>
      mutate(() => orpcClient.username.update({ username }), {
        kind: "profile",
      }),
  },

  push: {
    subscribe: (subscription: PushSubscriptionJSON) =>
      call(() =>
        orpcClient.push.subscribe({
          endpoint: subscription.endpoint!,
          keys: {
            p256dh: subscription.keys!.p256dh,
            auth: subscription.keys!.auth,
          },
        }),
      ),

    unsubscribe: (endpoint: string) =>
      call(() => orpcClient.push.unsubscribe({ endpoint })),

    test: () => call(() => orpcClient.push.test()),

    testTabInvite: () => call(() => orpcClient.push.testTabInvite()),
  },

  notifications: {
    getToken: async (): Promise<{ token: string }> => {
      try {
        const session = await authClient.getSession();
        const userId = session.data?.user?.id;
        if (!userId) throw new Error("Unauthorized");
        return { token: encodeBase64Url(`${userId}:${Date.now()}`) };
      } catch (err) {
        return {
          success: false,
          error: errorMessage(err),
        } as unknown as { token: string };
      }
    },

    getMissed: (since: number) =>
      call(() => orpcClient.notifications.listMissed({ since })),
  },

  ai: {
    addExpense: (body: { text: string }) =>
      mutate(
        () => orpcClient.ai.addExpense(body),
        (data): ApiChange | null => {
          const tabId = (data as { tabId?: unknown }).tabId;
          return typeof tabId === "string" ? { kind: "tab", tabId } : null;
        },
      ),
  },
};
