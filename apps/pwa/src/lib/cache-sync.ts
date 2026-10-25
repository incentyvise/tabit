import type { QueryClient } from "@tanstack/react-query";
import { onApiChange, type ApiChange } from "@/lib/api";
import {
  invalidateMembership,
  invalidateTabData,
  NON_PERSISTED_KEY_ROOTS,
  queryKeys,
} from "@/lib/queries";

/**
 * Bring the query cache up to date after a successful write. Active queries
 * refetch right away; inactive ones are marked stale and refetch on next use
 * (including the IndexedDB-persisted copy, which is re-dehydrated).
 */
export function applyApiChange(
  queryClient: QueryClient,
  change: ApiChange,
): Promise<unknown> {
  switch (change.kind) {
    case "tab":
      return invalidateTabData(queryClient, change.tabId, {
        expenseId: change.expenseId,
        settlementId: change.settlementId,
      });
    case "reaction":
      return Promise.all([
        queryClient.invalidateQueries({
          queryKey: queryKeys.expenseLists(change.tabId),
        }),
        queryClient.invalidateQueries({
          queryKey: queryKeys.expense(change.tabId, change.expenseId),
        }),
      ]);
    case "tabList":
      return Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.tabs }),
        queryClient.invalidateQueries({ queryKey: queryKeys.activity }),
      ]);
    case "membership":
      return Promise.all([
        invalidateMembership(queryClient),
        change.tabId
          ? invalidateTabData(queryClient, change.tabId)
          : Promise.resolve(),
      ]);
    case "recurringRule":
      if (change.deleted) {
        queryClient.removeQueries({
          queryKey: queryKeys.recurringExpense(change.ruleId),
        });
        return Promise.resolve();
      }
      return queryClient.invalidateQueries({
        queryKey: queryKeys.recurringExpense(change.ruleId),
      });
    case "preferences":
      return queryClient.invalidateQueries({
        queryKey: queryKeys.preferences,
      });
    case "profile":
      // Names, default currency and timezone show up almost everywhere.
      return queryClient.invalidateQueries({
        predicate: (q) => !NON_PERSISTED_KEY_ROOTS.has(q.queryKey[0]),
      });
  }
}

/** Subscribe the cache to every API mutation. Returns an unsubscribe. */
export function initCacheSync(queryClient: QueryClient): () => void {
  return onApiChange((change) => {
    void applyApiChange(queryClient, change);
  });
}
