import type { QueryClient } from "@tanstack/react-query";
import type { NotificationPayload } from "models";
import {
  invalidateMembership,
  invalidateTabData,
  queryKeys,
} from "@/lib/queries";

export function invalidateForNotification(
  queryClient: QueryClient,
  payload: NotificationPayload,
): void {
  switch (payload.type) {
    case "friend_request":
      void queryClient.invalidateQueries({
        queryKey: queryKeys.pendingFriendRequests,
      });
      return;
    case "tab_invite":
      void queryClient.invalidateQueries({
        queryKey: queryKeys.pendingTabInviteRequests,
      });
      return;
    case "friend_request_accepted":
    case "tab_invite_accepted":
      void invalidateMembership(queryClient);
      if ("tabId" in payload && payload.tabId) {
        void queryClient.invalidateQueries({
          queryKey: queryKeys.tab(payload.tabId),
        });
      }
      return;
    case "expense_reaction":
      // Reactions don't change balances or totals: only refresh expense views.
      void queryClient.invalidateQueries({
        queryKey: queryKeys.expenseLists(payload.tabId),
      });
      if (payload.expenseId) {
        void queryClient.invalidateQueries({
          queryKey: queryKeys.expense(payload.tabId, payload.expenseId),
        });
      }
      return;
    case "expense_added":
    case "expense_updated":
    case "expense_deleted":
    case "expense_restored":
    case "expenses_bulk_imported":
    case "placeholder_merged": {
      const expenseId =
        "expenseId" in payload && typeof payload.expenseId === "string"
          ? payload.expenseId
          : undefined;
      void invalidateTabData(queryClient, payload.tabId, { expenseId });
      return;
    }
    case "settlement_changed":
      void invalidateTabData(queryClient, payload.tabId, {
        settlementId: payload.settlementId,
      });
      return;
    case "recurring_rule_needs_fix":
      void queryClient.invalidateQueries({
        queryKey: queryKeys.recurringExpense(payload.ruleId),
      });
      return;
    default:
      return;
  }
}

/**
 * Events emitted while the socket was down are never replayed, so after a
 * reconnect refetch whatever is on screen and mark the rest stale.
 */
export function invalidateAfterReconnect(queryClient: QueryClient): void {
  void queryClient.invalidateQueries({
    predicate: (query) =>
      query.queryKey[0] !== "friendToken" &&
      query.queryKey[0] !== "tabInviteToken",
  });
}
