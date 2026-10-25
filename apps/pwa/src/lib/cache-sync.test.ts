import { beforeEach, describe, expect, test, vi } from "vitest";
import { QueryClient } from "@tanstack/react-query";

// Every oRPC procedure resolves to {} unless a test overrides it.
const rpc = vi.hoisted(() => {
  const handlers = new Map<string, () => Promise<unknown>>();
  const make = (path: string[]): unknown =>
    new Proxy(() => {}, {
      get: (_t, key: string) => make([...path, key]),
      apply: () => (handlers.get(path.join(".")) ?? (async () => ({})))(),
    });
  return { handlers, client: make([]) };
});
vi.mock("@/src/lib/orpc-client", () => ({ orpcClient: rpc.client }));
vi.mock("@/lib/auth-client", () => ({ authClient: {} }));

const { api } = await import("@/lib/api");
const { queryKeys } = await import("@/lib/queries");
const { initCacheSync } = await import("./cache-sync");

let qc: QueryClient;
let stop: () => void;

function seed(...keys: (readonly unknown[])[]) {
  for (const k of keys) qc.setQueryData(k, { seeded: true });
}
const stale = (k: readonly unknown[]) =>
  qc.getQueryState(k)?.isInvalidated ?? false;

beforeEach(() => {
  rpc.handlers.clear();
  stop?.();
  qc = new QueryClient();
  stop = initCacheSync(qc);
});

describe("cache sync after API writes", () => {
  test("creating an expense refreshes the tab, balances, lists and summaries", async () => {
    seed(
      queryKeys.tab("t1"),
      queryKeys.balances("t1"),
      queryKeys.expenseList("t1", "all", ""),
      queryKeys.expensesChart("t1"),
      queryKeys.tabs,
      queryKeys.friends,
      queryKeys.activity,
      queryKeys.balances("t2"),
    );

    const r = await api.expenses.create("t1", { amount: 10, description: "x" });

    expect(r.success).toBe(true);
    for (const k of [
      queryKeys.tab("t1"),
      queryKeys.balances("t1"),
      queryKeys.expenseList("t1", "all", ""),
      queryKeys.expensesChart("t1"),
      queryKeys.tabs,
      queryKeys.friends,
      queryKeys.activity,
    ]) {
      expect(stale(k), JSON.stringify(k)).toBe(true);
    }
    expect(stale(queryKeys.balances("t2"))).toBe(false);
  });

  test("editing/deleting an expense also refreshes its detail and audit log", async () => {
    seed(queryKeys.expense("t1", "e1"), queryKeys.expenseAuditLog("t1", "e1"));
    await api.expenses.delete("t1", "e1");
    expect(stale(queryKeys.expense("t1", "e1"))).toBe(true);
    expect(stale(queryKeys.expenseAuditLog("t1", "e1"))).toBe(true);
  });

  test("settlements refresh balances and the settlement detail", async () => {
    seed(queryKeys.settlements("t1"), queryKeys.settlement("t1", "s1"));
    await api.settlements.delete("t1", "s1");
    expect(stale(queryKeys.settlements("t1"))).toBe(true);
    expect(stale(queryKeys.settlement("t1", "s1"))).toBe(true);
  });

  test("creating a tab refreshes the tab list", async () => {
    seed(queryKeys.tabs);
    await api.tabs.create("Trip");
    expect(stale(queryKeys.tabs)).toBe(true);
  });

  test("reactions don't touch balances", async () => {
    seed(queryKeys.expense("t1", "e1"), queryKeys.balances("t1"));
    await api.expenses.addReaction("t1", "e1", "🔥");
    expect(stale(queryKeys.expense("t1", "e1"))).toBe(true);
    expect(stale(queryKeys.balances("t1"))).toBe(false);
  });

  test("accepting a friend request refreshes friends and pending requests", async () => {
    seed(queryKeys.friends, queryKeys.pendingFriendRequests);
    await api.friends.acceptRequest("r1");
    expect(stale(queryKeys.friends)).toBe(true);
    expect(stale(queryKeys.pendingFriendRequests)).toBe(true);
  });

  test("deleting a recurring rule drops it from the cache", async () => {
    seed(queryKeys.recurringExpense("rule1"));
    await api.recurringExpenses.delete("rule1");
    expect(qc.getQueryData(queryKeys.recurringExpense("rule1"))).toBeUndefined();
  });

  test("profile changes refresh everything except secret tokens", async () => {
    seed(queryKeys.tabs, queryKeys.tab("t1"), queryKeys.friendToken);
    await api.profile.update({ name: "New" });
    expect(stale(queryKeys.tabs)).toBe(true);
    expect(stale(queryKeys.tab("t1"))).toBe(true);
    expect(stale(queryKeys.friendToken)).toBe(false);
  });

  test("AI-added expenses refresh the tab they landed in", async () => {
    rpc.handlers.set("ai.addExpense", async () => ({ tabId: "t9" }));
    seed(queryKeys.balances("t9"));
    await api.ai.addExpense({ text: "lunch 20" });
    expect(stale(queryKeys.balances("t9"))).toBe(true);
  });

  test("a failed write leaves the cache alone", async () => {
    rpc.handlers.set("expenses.create", async () => {
      throw new Error("boom");
    });
    seed(queryKeys.balances("t1"));
    const r = await api.expenses.create("t1", { amount: 10, description: "x" });
    expect(r.success).toBe(false);
    expect(stale(queryKeys.balances("t1"))).toBe(false);
  });

  test("reads never invalidate", async () => {
    seed(queryKeys.tabs);
    await api.tabs.list();
    expect(stale(queryKeys.tabs)).toBe(false);
  });
});
