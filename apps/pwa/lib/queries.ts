import {
  infiniteQueryOptions,
  queryOptions,
  type QueryClient,
} from "@tanstack/react-query";
import { api } from "@/lib/api";

/**
 * Single source of truth for query keys + fetchers. Route loaders (prefetch)
 * and components must share these so the same key always holds the same
 * data shape.
 *
 * QueryFns throw on failure (instead of resolving to `[]` / `null`) so a
 * flaky network or expired session never overwrites good — and persisted —
 * data with an empty "success" result, and React Query can retry.
 */

export class ApiError extends Error {
  readonly status?: number;
  constructor(message: string, status?: number) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

export function unwrap<R extends { success: boolean }>(
  result: R,
): Extract<R, { success: true }> {
  if (!result.success) {
    const failure = result as unknown as { error?: string; status?: number };
    throw new ApiError(failure.error ?? "Request failed", failure.status);
  }
  return result as Extract<R, { success: true }>;
}

/** Client errors (4xx) won't succeed on retry; transport/5xx errors might. */
export function shouldRetryQuery(failureCount: number, error: unknown) {
  const status = error instanceof ApiError ? error.status : undefined;
  if (status !== undefined && status >= 400 && status < 500) return false;
  return failureCount < 2;
}

export const PAGE_SIZE = 20;

export type ExpenseListFilter = "all" | "involved" | "owed" | "owe";

export const queryKeys = {
  tabs: ["tabs"] as const,
  friends: ["friends"] as const,
  pendingFriendRequests: ["pendingFriendRequests"] as const,
  pendingTabInviteRequests: ["pendingTabInviteRequests"] as const,
  activity: ["activity"] as const,
  preferences: ["preferences"] as const,
  friendToken: ["friendToken"] as const,
  tab: (tabId: string) => ["tab", tabId] as const,
  /** Prefix for every expense query of a tab (lists, chart, import). */
  expenses: (tabId: string) => ["expenses", tabId] as const,
  /** Prefix of all paginated expense lists of a tab. */
  expenseLists: (tabId: string) => ["expenses", tabId, "list"] as const,
  expenseList: (tabId: string, filter: ExpenseListFilter, search: string) =>
    ["expenses", tabId, "list", filter, search] as const,
  expensesChart: (tabId: string) => ["expenses", tabId, "chart"] as const,
  expensesAll: (tabId: string) => ["expenses", tabId, "all"] as const,
  settlements: (tabId: string) => ["settlements", tabId] as const,
  balances: (tabId: string) => ["balances", tabId] as const,
  sharedGroupTabs: (tabId: string) => ["sharedGroupTabs", tabId] as const,
  expense: (tabId: string, expenseId: string) =>
    ["expense", tabId, expenseId] as const,
  expenseAuditLog: (tabId: string, expenseId: string) =>
    ["expenseAuditLog", tabId, expenseId] as const,
  settlement: (tabId: string, settlementId: string) =>
    ["settlement", tabId, settlementId] as const,
  settlementAuditLog: (tabId: string, settlementId: string) =>
    ["settlementAuditLog", tabId, settlementId] as const,
  recurringExpense: (ruleId: string) => ["recurring-expense", ruleId] as const,
  tabInviteToken: (tabId: string) => ["tabInviteToken", tabId] as const,
};

/** Keys that hold secrets and must never be written to IndexedDB. */
export const NON_PERSISTED_KEY_ROOTS = new Set<unknown>([
  "friendToken",
  "tabInviteToken",
]);

export const tabsQuery = () =>
  queryOptions({
    queryKey: queryKeys.tabs,
    queryFn: async () => unwrap(await api.tabs.list()).tabs ?? [],
  });

export const friendsQuery = () =>
  queryOptions({
    queryKey: queryKeys.friends,
    queryFn: async () => unwrap(await api.friends.list()).friends ?? [],
  });

export const pendingFriendRequestsQuery = () =>
  queryOptions({
    queryKey: queryKeys.pendingFriendRequests,
    queryFn: async () =>
      unwrap(await api.friends.getPendingRequests()).requests ?? [],
  });

export const pendingTabInviteRequestsQuery = () =>
  queryOptions({
    queryKey: queryKeys.pendingTabInviteRequests,
    queryFn: async () =>
      unwrap(await api.tabInvites.getPendingRequests()).requests ?? [],
  });

export const tabQuery = (tabId: string) =>
  queryOptions({
    queryKey: queryKeys.tab(tabId),
    queryFn: async () => unwrap(await api.tabs.get(tabId)).tab ?? null,
    enabled: !!tabId,
  });

export const expenseListQuery = (
  tabId: string,
  filter: ExpenseListFilter = "all",
  search = "",
) =>
  infiniteQueryOptions({
    queryKey: queryKeys.expenseList(tabId, filter, search),
    queryFn: async ({ pageParam }) => {
      const r = unwrap(
        await api.expenses.list(tabId, {
          limit: PAGE_SIZE,
          offset: pageParam,
          filter,
          ...(search ? { search } : {}),
        }),
      );
      return { expenses: r.expenses ?? [], total: r.total ?? 0 };
    },
    initialPageParam: 0,
    getNextPageParam: (lastPage, allPages) => {
      const loaded = allPages.reduce((sum, p) => sum + p.expenses.length, 0);
      return loaded < lastPage.total ? loaded : undefined;
    },
    enabled: !!tabId,
  });

/** Full, unpaginated expense history (chart). */
export const expensesChartQuery = (tabId: string) =>
  queryOptions({
    queryKey: queryKeys.expensesChart(tabId),
    queryFn: async () =>
      unwrap(await api.expenses.list(tabId, { filter: "all" })).expenses ?? [],
    enabled: !!tabId,
    staleTime: 5 * 60 * 1000,
  });

/** Full, unpaginated expense history (CSV import duplicate detection). */
export const expensesAllQuery = (tabId: string) =>
  queryOptions({
    queryKey: queryKeys.expensesAll(tabId),
    queryFn: async () => {
      const r = unwrap(await api.expenses.list(tabId));
      return { expenses: r.expenses ?? [], total: r.total ?? 0 };
    },
    enabled: !!tabId,
  });

export const settlementsQuery = (tabId: string) =>
  queryOptions({
    queryKey: queryKeys.settlements(tabId),
    queryFn: async () =>
      unwrap(await api.settlements.list(tabId)).settlements ?? [],
    enabled: !!tabId,
  });

export const balancesQuery = (tabId: string) =>
  queryOptions({
    queryKey: queryKeys.balances(tabId),
    queryFn: async () => unwrap(await api.tabs.getBalances(tabId)).balances ?? [],
    enabled: !!tabId,
  });

export const sharedGroupTabsQuery = (tabId: string) =>
  queryOptions({
    queryKey: queryKeys.sharedGroupTabs(tabId),
    queryFn: async () =>
      unwrap(await api.tabs.getSharedGroupTabs(tabId)).tabs ?? [],
    enabled: !!tabId,
  });

export const activityQuery = () =>
  infiniteQueryOptions({
    queryKey: queryKeys.activity,
    queryFn: async ({ pageParam }) => {
      const r = unwrap(
        await api.activity.list({ limit: PAGE_SIZE, offset: pageParam }),
      );
      return { items: r.items ?? [], total: r.total ?? 0 };
    },
    initialPageParam: 0,
    getNextPageParam: (lastPage, allPages) => {
      const loaded = allPages.reduce((sum, p) => sum + p.items.length, 0);
      return loaded < lastPage.total ? loaded : undefined;
    },
  });

export const expenseQuery = (tabId: string, expenseId: string) =>
  queryOptions({
    queryKey: queryKeys.expense(tabId, expenseId),
    queryFn: async () =>
      unwrap(await api.expenses.get(tabId, expenseId)).expense ?? null,
    enabled: !!tabId && !!expenseId,
  });

export const expenseAuditLogQuery = (tabId: string, expenseId: string) =>
  queryOptions({
    queryKey: queryKeys.expenseAuditLog(tabId, expenseId),
    queryFn: async () =>
      unwrap(await api.expenses.getAuditLog(tabId, expenseId)).auditLog ?? [],
    enabled: !!tabId && !!expenseId,
  });

export const settlementQuery = (tabId: string, settlementId: string) =>
  queryOptions({
    queryKey: queryKeys.settlement(tabId, settlementId),
    queryFn: async () =>
      unwrap(await api.settlements.get(tabId, settlementId)).settlement ?? null,
    enabled: !!tabId && !!settlementId,
  });

export const settlementAuditLogQuery = (tabId: string, settlementId: string) =>
  queryOptions({
    queryKey: queryKeys.settlementAuditLog(tabId, settlementId),
    queryFn: async () =>
      unwrap(await api.settlements.getAuditLog(tabId, settlementId))
        .auditLog ?? [],
    enabled: !!tabId && !!settlementId,
  });

export const recurringExpenseQuery = (ruleId: string) =>
  queryOptions({
    queryKey: queryKeys.recurringExpense(ruleId),
    queryFn: async () => {
      const rule = unwrap(await api.recurringExpenses.get(ruleId)).rule;
      if (!rule) throw new ApiError("Failed to load");
      return rule;
    },
    enabled: !!ruleId,
  });

/** Full preferences result (`success: true` + fields). Use `select` for slices. */
export const preferencesQuery = () =>
  queryOptions({
    queryKey: queryKeys.preferences,
    queryFn: async () => unwrap(await api.preferences.get()),
  });

export const friendTokenQuery = () =>
  queryOptions({
    queryKey: queryKeys.friendToken,
    queryFn: async () => {
      const url = unwrap(await api.friends.getToken()).url;
      if (!url) throw new ApiError("Failed to load");
      return url;
    },
  });

export const tabInviteTokenQuery = (tabId: string) =>
  queryOptions({
    queryKey: queryKeys.tabInviteToken(tabId),
    queryFn: async () => {
      const url = unwrap(await api.tabInvites.getToken(tabId)).url;
      if (!url) throw new ApiError("Failed to load");
      return url;
    },
    enabled: !!tabId,
  });

/**
 * Everything derived from a tab's ledger. Call after any expense / settlement /
 * membership mutation. Realtime events skip the actor, so the actor's own
 * invalidation must be complete.
 */
export function invalidateTabData(
  queryClient: QueryClient,
  tabId: string,
  detail?: { expenseId?: string; settlementId?: string },
) {
  const keys: readonly (readonly unknown[])[] = [
    queryKeys.tab(tabId),
    queryKeys.expenses(tabId),
    queryKeys.balances(tabId),
    queryKeys.settlements(tabId),
    queryKeys.sharedGroupTabs(tabId),
    // List summaries show balance / expense count / last expense date.
    queryKeys.tabs,
    queryKeys.friends,
    queryKeys.activity,
    ...(detail?.expenseId
      ? [
          queryKeys.expense(tabId, detail.expenseId),
          queryKeys.expenseAuditLog(tabId, detail.expenseId),
        ]
      : []),
    ...(detail?.settlementId
      ? [
          queryKeys.settlement(tabId, detail.settlementId),
          queryKeys.settlementAuditLog(tabId, detail.settlementId),
        ]
      : []),
  ];
  return Promise.all(
    keys.map((queryKey) => queryClient.invalidateQueries({ queryKey })),
  );
}

/** After accepting a friend request / tab invite. */
export function invalidateMembership(queryClient: QueryClient) {
  return Promise.all(
    [
      queryKeys.friends,
      queryKeys.tabs,
      queryKeys.pendingFriendRequests,
      queryKeys.pendingTabInviteRequests,
      queryKeys.activity,
    ].map((queryKey) => queryClient.invalidateQueries({ queryKey })),
  );
}
