import { describe, expect, test } from "vitest";
import { SETTLED_AFTER_MS, splitSettledTabs } from "./tab-sections";

const now = Date.parse("2026-10-25T12:00:00Z");
const daysAgo = (d: number) =>
  new Date(now - d * 24 * 60 * 60 * 1000).toISOString();

describe("splitSettledTabs", () => {
  test("moves tabs settled for more than 7 days, keeps order", () => {
    const tabs = [
      {
        id: "a",
        isSettled: true,
        expenseCount: 3,
        lastExpenseDate: daysAgo(10),
      },
      {
        id: "b",
        isSettled: false,
        expenseCount: 3,
        lastExpenseDate: daysAgo(30),
      },
      {
        id: "c",
        isSettled: true,
        expenseCount: 3,
        lastExpenseDate: daysAgo(3),
      },
      {
        id: "d",
        isSettled: true,
        expenseCount: 1,
        lastExpenseDate: daysAgo(8),
      },
    ];
    const { active, settled } = splitSettledTabs(tabs, now);
    expect(active.map((t) => t.id)).toEqual(["b", "c"]);
    expect(settled.map((t) => t.id)).toEqual(["a", "d"]);
  });

  test("exactly 7 days is still active", () => {
    const { settled } = splitSettledTabs(
      [
        {
          isSettled: true,
          expenseCount: 1,
          lastExpenseDate: new Date(now - SETTLED_AFTER_MS).toISOString(),
        },
      ],
      now,
    );
    expect(settled).toHaveLength(0);
  });

  test("empty tabs and tabs without dates or the flag stay active", () => {
    const { settled } = splitSettledTabs(
      [
        { isSettled: true, expenseCount: 0, lastExpenseDate: daysAgo(30) },
        { isSettled: true, expenseCount: 2, lastExpenseDate: null },
        { expenseCount: 2, lastExpenseDate: daysAgo(30) },
      ],
      now,
    );
    expect(settled).toHaveLength(0);
  });
});
