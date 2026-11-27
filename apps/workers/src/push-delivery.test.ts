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

describe("expense added for someone else", () => {
  const base = {
    type: "expense_added",
    tabId: "t1",
    expenseId: "e1",
    tabName: "Trip",
    fromUserName: "Parth",
    payerName: "Alice",
    description: "dinner",
    amount: "90",
    currencySymbol: "$",
  };

  test("title names who added it", () => {
    expect(getPushTitle(base)).toBe("Parth added $90 for dinner in Trip");
  });

  test("payer is told what they're owed", () => {
    expect(
      getPushBody({ ...base, recipientIsPayer: true, recipientOwedAmount: "60" }),
    ).toBe("You paid. You're owed $60");
  });

  test("others are told who paid and their share", () => {
    expect(getPushBody({ ...base, recipientOweAmount: "30", viaMcpClient: "Claude" })).toBe(
      "Alice paid. You owe $30 · via Claude",
    );
  });

  test("edit that changes your share but not the total", () => {
    expect(
      getPushBody({ ...base, type: "expense_updated", shareChanged: true, recipientOweAmount: "30" }),
    ).toBe("You owe $30");
  });

  test("recurring occurrence paid by someone else says who paid", () => {
    expect(
      getPushBody({
        ...base,
        recurringRuleId: "r1",
        recurringRuleTitle: "Rent rule",
        ruleOwnerName: "Parth",
        description: "Rent",
        recipientOweAmount: "300",
      }),
    ).toBe("Tab created Rent based on Rent rule by Parth. Alice paid. You owe $300.");
  });

  test("bulk import: title has the total, body the recipient's count", () => {
    const bulk = { type: "expenses_bulk_imported", tabId: "t1", tabName: "Trip", fromUserName: "Parth", count: 10, involvedCount: 2 };
    expect(getPushTitle(bulk)).toBe("Parth imported 10 expenses to Trip");
    expect(getPushBody(bulk)).toBe("2 expenses involving you in Trip");
  });

  test("removed from an edited expense", () => {
    expect(
      getPushBody({ ...base, type: "expense_updated", removedFromExpense: true }),
    ).toBe("You're no longer part of this expense");
  });
});
