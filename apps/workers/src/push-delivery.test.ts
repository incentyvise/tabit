import { describe, expect, test, vi } from "vitest";

vi.mock("db", () => ({ db: {}, pushSubscription: {} }));
vi.mock("otel", () => ({ log: vi.fn() }));

const { getNavigatePath, getPushBody, getPushTitle } = await import(
  "./push-delivery.js"
);

const settlement = {
  type: "settlement_changed",
  action: "recorded",
  tabId: "t1",
  tabName: "Trip",
  fromUserName: "Alice",
  payerName: "Alice",
  payeeName: "Bob",
  amount: "12.50",
  currencySymbol: "€",
};

describe("settlement push copy", () => {
  test("recorded", () => {
    expect(getPushTitle(settlement)).toBe(
      "Payment recorded: Alice paid Bob €12.50",
    );
    expect(getPushBody(settlement)).toBe("Alice recorded this payment in Trip.");
  });

  test("updated / deleted verbs", () => {
    expect(getPushTitle({ ...settlement, action: "updated" })).toMatch(/^Payment edited/);
    expect(getPushTitle({ ...settlement, action: "deleted" })).toMatch(/^Payment removed/);
    expect(getPushBody({ ...settlement, action: "deleted" })).toBe(
      "Alice removed this payment in Trip.",
    );
  });

  test("direct tabs omit the tab name", () => {
    expect(getPushBody({ ...settlement, isDirect: true })).toBe(
      "Alice recorded this payment.",
    );
  });

  test("opens the tab", () => {
    expect(getNavigatePath(settlement)).toBe("/tabs/t1");
  });
});

describe("other push copy", () => {
  test("expense_added uses payer, amount and tab", () => {
    expect(
      getPushTitle({
        type: "expense_added",
        fromUserName: "Bob",
        description: "Dinner",
        amount: "30",
        currencySymbol: "$",
        tabName: "Trip",
      }),
    ).toBe("Bob paid $30 for Dinner in Trip");
  });

  test("expense links go to the expense", () => {
    expect(
      getNavigatePath({ type: "expense_updated", tabId: "t1", expenseId: "e1" }),
    ).toBe("/tabs/t1/expenses/e1");
  });

  test("forcePush test notifications", () => {
    expect(getPushTitle({ type: "poke", forcePush: true })).toBe("Test push notification");
  });
});
