import type { QueryClient } from "@tanstack/react-query";
import {
  activityQuery,
  balancesQuery,
  expenseListQuery,
  expenseQuery,
  friendsQuery,
  pendingFriendRequestsQuery,
  pendingTabInviteRequestsQuery,
  recurringExpenseQuery,
  settlementQuery,
  settlementsQuery,
  tabQuery,
  tabsQuery,
} from "@/lib/queries";

/*
 * Fire-and-forget prefetches — they never block navigation. They reuse the
 * exact query options the pages use, so a prefetch always warms the entry the
 * page reads (same key, same data shape). prefetchQuery is a no-op while the
 * cached data is still fresh.
 */

export function prefetchTabs(queryClient: QueryClient) {
  void queryClient.prefetchQuery(tabsQuery());
  void queryClient.prefetchQuery(pendingTabInviteRequestsQuery());
}

/** Just the tab record (members / manage pages). */
export function prefetchTabMeta(queryClient: QueryClient, tabId: string) {
  void queryClient.prefetchQuery(tabQuery(tabId));
}

export function prefetchTab(queryClient: QueryClient, tabId: string) {
  prefetchTabMeta(queryClient, tabId);
  void queryClient.prefetchInfiniteQuery(expenseListQuery(tabId));
  void queryClient.prefetchQuery(settlementsQuery(tabId));
  void queryClient.prefetchQuery(balancesQuery(tabId));
}

export function prefetchFriends(queryClient: QueryClient) {
  void queryClient.prefetchQuery(friendsQuery());
  void queryClient.prefetchQuery(pendingFriendRequestsQuery());
}

export function prefetchActivity(queryClient: QueryClient) {
  void queryClient.prefetchInfiniteQuery(activityQuery());
}

export function prefetchExpense(
  queryClient: QueryClient,
  tabId: string,
  expenseId: string,
) {
  prefetchTabMeta(queryClient, tabId);
  void queryClient.prefetchQuery(expenseQuery(tabId, expenseId));
}

export function prefetchSettlement(
  queryClient: QueryClient,
  tabId: string,
  settlementId: string,
) {
  prefetchTabMeta(queryClient, tabId);
  void queryClient.prefetchQuery(settlementQuery(tabId, settlementId));
}

export function prefetchRecurringExpense(
  queryClient: QueryClient,
  ruleId: string,
) {
  void queryClient.prefetchQuery(recurringExpenseQuery(ruleId));
}
