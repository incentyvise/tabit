import { beforeEach, describe, expect, test, vi } from "vitest";
import { QueryClient } from "@tanstack/react-query";
import type { NotificationPayload } from "models";
import { queryKeys } from "@/lib/queries";
import {
  invalidateAfterReconnect,
  invalidateForNotification,
} from "./invalidate-notification";

vi.mock("@/lib/api", () => ({ api: {} }));

let qc: QueryClient;

/** Seed a query so invalidation has something to mark stale. */
function seed(key: readonly unknown[]) {
  qc.setQueryData(key, { seeded: true });
}
function isInvalidated(key: readonly unknown[]) {
  return qc.getQueryState(key)?.isInvalidated ?? false;
}

const base = {
  tabId: "t1",
  tabName: "Trip",
  fromUserId: "u2",
  fromUserName: "Bob",
  createdAt: new Date().toISOString(),
};

beforeEach(() => {
  qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
});

describe("invalidateForNotification", () => {
  test("settlement_changed refreshes balances, settlements and the settlement detail", () => {
    seed(queryKeys.balances("t1"));
    seed(queryKeys.settlements("t1"));
    seed(queryKeys.settlement("t1", "s1"));
    seed(queryKeys.tabs);
    seed(queryKeys.balances("other"));

    invalidateForNotification(qc, {
      ...base,
      type: "settlement_changed",
      action: "recorded",
      settlementId: "s1",
      payerName: "Bob",
      payeeName: "Alice",
      amount: "10.00",
    } satisfies NotificationPayload);

    expect(isInvalidated(queryKeys.balances("t1"))).toBe(true);
    expect(isInvalidated(queryKeys.settlements("t1"))).toBe(true);
    expect(isInvalidated(queryKeys.settlement("t1", "s1"))).toBe(true);
    expect(isInvalidated(queryKeys.tabs)).toBe(true);
    expect(isInvalidated(queryKeys.balances("other"))).toBe(false);
  });

  test("expense_reaction only touches expense views, not balances", () => {
    seed(queryKeys.expenseLists("t1"));
    seed(queryKeys.expense("t1", "e1"));
    seed(queryKeys.balances("t1"));

    invalidateForNotification(qc, {
      ...base,
      type: "expense_reaction",
      expenseId: "e1",
      description: "Dinner",
      amount: "30",
      emoji: "🔥",
    });

    expect(isInvalidated(queryKeys.expenseLists("t1"))).toBe(true);
    expect(isInvalidated(queryKeys.expense("t1", "e1"))).toBe(true);
    expect(isInvalidated(queryKeys.balances("t1"))).toBe(false);
  });

  test("expense_added invalidates the tab's data and the expense detail", () => {
    seed(queryKeys.balances("t1"));
    seed(queryKeys.expense("t1", "e1"));

    invalidateForNotification(qc, {
      ...base,
      type: "expense_added",
      expenseId: "e1",
      description: "Dinner",
      amount: "30",
    });

    expect(isInvalidated(queryKeys.balances("t1"))).toBe(true);
    expect(isInvalidated(queryKeys.expense("t1", "e1"))).toBe(true);
  });

  test("friend_request only refreshes pending requests", () => {
    seed(queryKeys.pendingFriendRequests);
    seed(queryKeys.friends);

    invalidateForNotification(qc, {
      type: "friend_request",
      requestId: "r1",
      fromUserId: "u2",
      fromUserName: "Bob",
      fromUserUsername: "bob",
      createdAt: base.createdAt,
    });

    expect(isInvalidated(queryKeys.pendingFriendRequests)).toBe(true);
    expect(isInvalidated(queryKeys.friends)).toBe(false);
  });
});

describe("invalidateAfterReconnect", () => {
  test("invalidates everything except invite/friend tokens", () => {
    seed(queryKeys.tabs);
    seed(queryKeys.friendToken);
    seed(queryKeys.tabInviteToken("t1"));

    invalidateAfterReconnect(qc);

    expect(isInvalidated(queryKeys.tabs)).toBe(true);
    expect(isInvalidated(queryKeys.friendToken)).toBe(false);
    expect(isInvalidated(queryKeys.tabInviteToken("t1"))).toBe(false);
  });
});
