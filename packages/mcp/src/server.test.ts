import { describe, it, expect, beforeEach, vi } from "vitest";
import { Client } from "@modelcontextprotocol/client";
import { InMemoryTransport } from "@modelcontextprotocol/server";
import { tab, user, runWithWriteSource } from "data";
import { expenseService, settlementService, tabService, friendService } from "services";
import { createTabMcpServer } from "./server.js";
import { dateRange, categoryKey, similarDescriptions } from "./expense-query.js";

const ME = "u-me";
const SAM = "u-sam";

const samTab = {
  id: "t-sam",
  name: "Direct",
  currency: "INR",
  createdAt: new Date(),
  isDirect: true,
  members: [
    { userId: ME, role: "member", user: { id: ME, email: "me@x.test", name: "Parth", username: "parth" } },
    { userId: SAM, role: "member", user: { id: SAM, email: "sam@x.test", name: "Sam Lee", username: "samlee" } },
  ],
  participants: [
    { id: "p-me", kind: "member", userId: ME, displayName: "Parth", user: { id: ME, email: "me@x.test", name: "Parth", username: "parth" } },
    { id: "p-sam", kind: "member", userId: SAM, displayName: "Sam Lee", user: { id: SAM, email: "sam@x.test", name: "Sam Lee", username: "samlee" } },
  ],
};

const goaTab = {
  ...samTab,
  id: "t-goa",
  name: "Goa Trip",
  isDirect: false,
  participants: [
    ...samTab.participants,
    { id: "p-priya", kind: "placeholder", userId: null, displayName: "Priya", user: null },
  ],
};

async function connect(scopes = ["tab:read", "tab:write"]) {
  const server = await createTabMcpServer({ userId: ME, clientId: "c1", clientName: "Claude", scopes });
  const [clientT, serverT] = InMemoryTransport.createLinkedPair();
  await server.connect(serverT);
  const client = new Client({ name: "test", version: "1.0.0" });
  await client.connect(clientT);
  return client;
}

function text(result: { content: unknown }): string {
  return (result.content as Array<{ type: string; text: string }>).map((c) => c.text).join("\n");
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(user.getById).mockResolvedValue({
    id: ME, name: "Parth", username: "parth", email: "me@x.test", defaultCurrency: "INR", timezone: "Asia/Kolkata",
  } as never);
  vi.mocked(tab.getTabsForUser).mockResolvedValue([
    { id: "t-goa", name: "Goa Trip", currency: "INR", createdAt: new Date(), balance: 0 },
    { id: "t-goa2", name: "Goa Trip 2024", currency: "INR", createdAt: new Date(), balance: 0 },
  ] as never);
  vi.mocked(tab.getDirectTabsForUser).mockResolvedValue([
    {
      id: "t-sam", currency: "INR", createdAt: new Date(), balance: -250, expenseCount: 3,
      friend: { id: SAM, email: "sam@x.test", name: "Sam Lee", username: "samlee" },
    },
  ] as never);
  vi.mocked(tab.getWithMembers).mockImplementation(async (id: string) =>
    (id === "t-sam" ? samTab : id === "t-goa" ? goaTab : null) as never,
  );
  vi.mocked(expenseService.getForTab).mockResolvedValue({
    success: true,
    data: { expenses: [], total: 0 },
  } as never);
});

/** An expense row as the data layer returns it. */
function exp(
  id: string,
  description: string,
  amount: number,
  date: string,
  paidBy: string,
  splits: Array<[participantId: string, userId: string | null, amount: number]>,
) {
  return {
    id, tabId: "t-goa", description, amount, originalAmount: amount, currency: "INR",
    expenseDate: new Date(date), createdAt: new Date(date), deletedAt: null, recurringRuleId: null,
    paidById: paidBy === "p-me" ? ME : paidBy === "p-sam" ? SAM : null,
    paidByParticipantId: paidBy, splitType: "equal",
    splits: splits.map(([participantId, userId, a], i) => ({
      id: `${id}-s${i}`, expenseId: id, participantId, userId, amount: a, weight: null,
    })),
    reactions: [],
  };
}

describe("tool listing", () => {
  it("exposes write tools only with tab:write", async () => {
    const rw = await connect();
    const rwNames = (await rw.listTools()).tools.map((t) => t.name);
    expect(rwNames).toContain("create_expense");
    expect(rwNames).toContain("get_overview");

    const ro = await connect(["tab:read"]);
    const roNames = (await ro.listTools()).tools.map((t) => t.name);
    expect(roNames).toContain("get_overview");
    expect(roNames).not.toContain("create_expense");
    expect(roNames).not.toContain("delete_expense");
  });

  it("marks destructive tools", async () => {
    const client = await connect();
    const tools = (await client.listTools()).tools;
    expect(tools.find((t) => t.name === "delete_expense")?.annotations?.destructiveHint).toBe(true);
    expect(tools.find((t) => t.name === "list_tabs")?.annotations?.readOnlyHint).toBe(true);
  });
});

describe("create_expense", () => {
  it("resolves a friend by username and stamps the MCP write source", async () => {
    vi.mocked(expenseService.create).mockResolvedValue({
      success: true,
      data: {
        expenseId: "e1", tabId: "t-sam", amount: 500, description: "Dinner", tabName: "Sam Lee",
        currency: "INR", expenseCurrency: "INR", originalAmount: 500,
        participants: [
          { userId: ME, name: "Parth", paid: 500 },
          { userId: SAM, name: "Sam Lee", owes: 250 },
        ],
      },
    } as never);
    const client = await connect();
    const result = await client.callTool({
      name: "create_expense",
      arguments: { tab: "@samlee", description: "Dinner", amount: 500 },
    });
    expect(result.isError).toBeFalsy();
    expect(text(result)).toContain("Added \"Dinner\"");
    const [input, performedBy] = vi.mocked(expenseService.create).mock.calls[0]!;
    expect(performedBy).toBe(ME);
    expect(input).toMatchObject({ tabId: "t-sam", amount: 500, paidById: ME, splitType: "equal" });
    expect(runWithWriteSource).toHaveBeenCalledWith(
      { source: "mcp", clientId: "c1", clientName: "Claude" },
      expect.any(Function),
    );
  });

  it("asks instead of guessing when a tab name is ambiguous", async () => {
    const client = await connect();
    const result = await client.callTool({
      name: "create_expense",
      arguments: { tab: "goa", description: "Snacks", amount: 100 },
    });
    expect(result.isError).toBe(true);
    expect(text(result)).toContain("matches more than one");
    expect(text(result)).toContain("Goa Trip 2024");
    expect(expenseService.create).not.toHaveBeenCalled();
  });

  it("rejects placeholders in percent splits", async () => {
    const client = await connect();
    const result = await client.callTool({
      name: "create_expense",
      arguments: {
        tab: "t-goa",
        description: "Villa",
        amount: 9000,
        splitType: "percent",
        splits: [
          { person: "me", percent: 50 },
          { person: "Priya", percent: 50 },
        ],
      },
    });
    expect(result.isError).toBe(true);
    expect(text(result)).toContain("placeholder");
    expect(expenseService.create).not.toHaveBeenCalled();
  });

  it("surfaces service errors to the model", async () => {
    vi.mocked(expenseService.create).mockResolvedValue({
      success: false, error: "Invalid currency code", status: 400,
    } as never);
    const client = await connect();
    const result = await client.callTool({
      name: "create_expense",
      arguments: { tab: "t-sam", description: "x", amount: 1, currency: "ZZZ" },
    });
    expect(result.isError).toBe(true);
    expect(text(result)).toContain("Invalid currency code");
  });

  it("hides unexpected errors", async () => {
    vi.mocked(expenseService.create).mockRejectedValue(new Error("db exploded: secret"));
    const client = await connect();
    const result = await client.callTool({
      name: "create_expense",
      arguments: { tab: "t-sam", description: "x", amount: 1 },
    });
    expect(result.isError).toBe(true);
    expect(text(result)).not.toContain("secret");
  });
});

describe("record_settlement", () => {
  it("defaults direction and amount in a friend tab", async () => {
    vi.mocked(tabService.getBalancesForTab).mockResolvedValue({
      success: true,
      data: [
        { participantId: "p-me", userId: ME, kind: "member", displayName: "Parth", amount: -250, user: samTab.members[0]!.user },
        { participantId: "p-sam", userId: SAM, kind: "member", displayName: "Sam Lee", amount: 250, user: samTab.members[1]!.user },
      ],
    } as never);
    vi.mocked(settlementService.record).mockResolvedValue({ success: true, data: undefined } as never);
    const client = await connect();
    const result = await client.callTool({ name: "record_settlement", arguments: { tab: "Sam" } });
    expect(result.isError).toBeFalsy();
    const call = vi.mocked(settlementService.record).mock.calls[0]!;
    expect(call[0]).toBe("t-sam");
    expect(call[3]).toBe(250);
    expect(call[8]).toBe("p-me");
    expect(call[9]).toBe("p-sam");
  });
});

describe("poke_friend", () => {
  it("reports the cooldown from the service", async () => {
    vi.mocked(friendService.poke).mockResolvedValue({
      success: false, error: "You already poked this friend recently. Try again in 9 minutes.", status: 429,
    } as never);
    const client = await connect();
    const result = await client.callTool({ name: "poke_friend", arguments: { friend: "samlee" } });
    expect(result.isError).toBe(true);
    expect(text(result)).toContain("Rate limited");
  });
});

describe("get_overview", () => {
  it("summarises balances without emails", async () => {
    const client = await connect();
    const result = await client.callTool({ name: "get_overview", arguments: {} });
    const out = text(result);
    expect(out).toContain("you owe 250");
    expect(out).not.toContain("@x.test");
  });
});

describe("review regressions", () => {
  it("write tools refuse prefix-only name matches instead of guessing", async () => {
    const withSamantha = {
      ...goaTab,
      participants: [
        goaTab.participants[0]!,
        { id: "p-samantha", kind: "placeholder", userId: null, displayName: "Samantha", user: null },
      ],
    };
    vi.mocked(tab.getWithMembers).mockResolvedValue(withSamantha as never);
    vi.mocked(tabService.getBalancesForTab).mockResolvedValue({ success: true, data: [] } as never);
    const client = await connect();
    const result = await client.callTool({
      name: "record_settlement",
      arguments: { tab: "t-goa", from: "Sam", to: "me", amount: 100 },
    });
    expect(result.isError).toBe(true);
    expect(text(result)).toContain("Did you mean Samantha");
    expect(settlementService.record).not.toHaveBeenCalled();
  });

  it("asks who paid whom in a settled-up 1:1 tab", async () => {
    vi.mocked(tabService.getBalancesForTab).mockResolvedValue({
      success: true,
      data: [
        { participantId: "p-me", userId: ME, kind: "member", displayName: "Parth", amount: 0, user: samTab.members[0]!.user },
        { participantId: "p-sam", userId: SAM, kind: "member", displayName: "Sam Lee", amount: 0, user: samTab.members[1]!.user },
      ],
    } as never);
    const client = await connect();
    const result = await client.callTool({ name: "record_settlement", arguments: { tab: "@samlee", amount: 500 } });
    expect(result.isError).toBe(true);
    expect(text(result)).toContain("who paid whom");
    expect(settlementService.record).not.toHaveBeenCalled();
  });

  it("converts custom split amounts from the expense currency to the tab currency", async () => {
    const { convertToTabCurrency } = await import("services");
    vi.mocked(convertToTabCurrency).mockResolvedValue({
      success: true,
      data: { amountTab: 8300, rateDate: "2026-11-26" },
    } as never);
    vi.mocked(expenseService.create).mockResolvedValue({
      success: true,
      data: {
        expenseId: "e2", tabId: "t-sam", amount: 8300, description: "Hotel", tabName: "Sam Lee",
        currency: "INR", expenseCurrency: "USD", originalAmount: 100, participants: [],
      },
    } as never);
    const client = await connect();
    const result = await client.callTool({
      name: "create_expense",
      arguments: {
        tab: "@samlee",
        description: "Hotel",
        amount: 100,
        currency: "USD",
        splitType: "custom",
        splits: [
          { person: "me", amount: 60 },
          { person: "samlee", amount: 40 },
        ],
      },
    });
    expect(result.isError).toBeFalsy();
    const [input] = vi.mocked(expenseService.create).mock.calls[0]!;
    expect(input.amount).toBe(100);
    expect(input.currency).toBe("USD");
    expect(input.splits).toEqual([
      { userId: ME, amount: 4980 },
      { userId: SAM, amount: 3320 },
    ]);
  });

  it("rejects custom amounts that don't add up to the entered total", async () => {
    const client = await connect();
    const result = await client.callTool({
      name: "create_expense",
      arguments: {
        tab: "@samlee", description: "x", amount: 100, splitType: "custom",
        splits: [{ person: "me", amount: 60 }, { person: "samlee", amount: 30 }],
      },
    });
    expect(result.isError).toBe(true);
    expect(text(result)).toContain("add up to 90");
  });
});

describe("list_expenses filters", () => {
  it("passes amount, payer and month filters to the server in the user's timezone", async () => {
    const client = await connect();
    const result = await client.callTool({
      name: "list_expenses",
      arguments: { tab: "Goa Trip", amount: 1967, paidBy: "sam", from: "2026-11", to: "2026-11" },
    });
    expect(result.isError).toBeFalsy();
    const [tabId, userId, opts] = vi.mocked(expenseService.getForTab).mock.calls[0]!;
    expect(tabId).toBe("t-goa");
    expect(userId).toBe(ME);
    expect(opts).toMatchObject({
      amount: 1967,
      paidBy: { participantId: "p-sam", userId: SAM },
      from: new Date("2026-10-31T18:30:00.000Z"),
      to: new Date("2026-11-30T18:30:00.000Z"),
    });
  });

  it("rejects bad dates", async () => {
    const client = await connect();
    const result = await client.callTool({ name: "list_expenses", arguments: { tab: "Goa Trip", from: "Nov" } });
    expect(result.isError).toBe(true);
    expect(text(result)).toContain("must be a date");
  });
});

describe("summarize_expenses", () => {
  it("totals a search with your share and you-paid", async () => {
    vi.mocked(expenseService.getForTab).mockResolvedValue({
      success: true,
      data: {
        total: 3,
        expenses: [
          exp("e1", "Blinkit", 600, "2026-11-03T10:00:00Z", "p-me", [["p-me", ME, 300], ["p-sam", SAM, 300]]),
          exp("e2", "Blinkit 2.0", 400, "2026-11-10T10:00:00Z", "p-sam", [["p-me", ME, 200], ["p-sam", SAM, 200]]),
          exp("e3", "blinkit diwali", 900, "2026-11-12T10:00:00Z", "p-sam", [["p-me", ME, 300], ["p-sam", SAM, 300], ["p-priya", null, 300]]),
        ],
      },
    } as never);
    const client = await connect();
    const result = await client.callTool({
      name: "summarize_expenses",
      arguments: { tab: "Goa Trip", search: "blinkit", from: "2026-11", to: "2026-11", groupBy: "category" },
    });
    expect(result.isError).toBeFalsy();
    const out = text(result);
    expect(out).toContain("3 expenses");
    expect(out).toContain("total 1900 INR");
    expect(out).toContain("your share 800 INR");
    expect(out).toContain("you paid 600 INR");
    const data = JSON.parse(out.split("\n").slice(1).join("\n"));
    expect(data.groups).toEqual([
      { group: "Blinkit", key: "blinkit", currency: "INR", total: 1900, count: 3, yourShare: 800, youPaid: 600 },
    ]);
    expect(vi.mocked(expenseService.getForTab).mock.calls[0]![2]).toMatchObject({ search: "blinkit", excludeDeleted: true });
  });

  it("groups by person and covers every tab when tab is omitted", async () => {
    vi.mocked(expenseService.getForTab).mockImplementation(async (tabId: string) => ({
      success: true,
      data: {
        total: 1,
        expenses: tabId === "t-goa"
          ? [exp("e1", "Villa", 900, "2026-11-03T10:00:00Z", "p-me", [["p-me", ME, 300], ["p-sam", SAM, 300], ["p-priya", null, 300]])]
          : [],
      },
    }) as never);
    const client = await connect();
    const result = await client.callTool({ name: "summarize_expenses", arguments: { groupBy: "person" } });
    expect(result.isError).toBeFalsy();
    const data = JSON.parse(text(result).split("\n").slice(1).join("\n"));
    expect(data.totals).toEqual([{ currency: "INR", total: 900, count: 1, yourShare: 300, youPaid: 900 }]);
    expect(data.groups.map((g: { group: string; share: number }) => [g.group, g.share])).toEqual([
      ["You", 300], ["Sam Lee", 300], ["Priya", 300],
    ]);
    // Both the group tab and the friend tab were scanned.
    expect(vi.mocked(expenseService.getForTab).mock.calls.map((c) => c[0]).sort()).toEqual(["t-goa", "t-sam"]);
  });
});

describe("duplicates and split presets", () => {
  it("create_expense refuses a likely duplicate unless allowDuplicate is set", async () => {
    vi.mocked(expenseService.getForTab).mockResolvedValue({
      success: true,
      data: { total: 1, expenses: [exp("e1", "Brown table", 1967, new Date().toISOString(), "p-me", [["p-me", ME, 983.5], ["p-sam", SAM, 983.5]])] },
    } as never);
    vi.mocked(expenseService.create).mockResolvedValue({
      success: true,
      data: { expenseId: "e9", tabId: "t-goa", amount: 1967, description: "Brown table", tabName: "Goa Trip", currency: "INR", expenseCurrency: "INR", originalAmount: 1967, participants: [] },
    } as never);
    const client = await connect();
    const first = await client.callTool({ name: "create_expense", arguments: { tab: "t-goa", description: "brown table", amount: 1967 } });
    expect(first.isError).toBe(true);
    expect(text(first)).toContain("possibleDuplicates");
    expect(expenseService.create).not.toHaveBeenCalled();

    const second = await client.callTool({
      name: "create_expense",
      arguments: { tab: "t-goa", description: "brown table", amount: 1967, allowDuplicate: true },
    });
    expect(second.isError).toBeFalsy();
    expect(expenseService.create).toHaveBeenCalledOnce();
  });

  it("splitLike copies a custom split scaled to the new amount", async () => {
    vi.mocked(expenseService.getById).mockResolvedValue({
      success: true,
      data: {
        id: "rent-nov", tabId: "t-sam", splitType: "custom", description: "Rent", amount: 50000, currency: "INR",
        originalAmount: 50000, expenseDate: new Date(), paidById: ME, paidByParticipantId: "p-me", deletedAt: null,
        splits: [
          { userId: ME, participantId: "p-me", amount: 37000, weight: null },
          { userId: SAM, participantId: "p-sam", amount: 13000, weight: null },
        ],
      },
    } as never);
    vi.mocked(expenseService.create).mockResolvedValue({
      success: true,
      data: { expenseId: "e10", tabId: "t-sam", amount: 52000, description: "Rent Dec", tabName: "x", currency: "INR", expenseCurrency: "INR", originalAmount: 52000, participants: [] },
    } as never);
    const client = await connect();
    const result = await client.callTool({
      name: "create_expense",
      arguments: { tab: "@samlee", description: "Rent Dec", amount: 52000, splitLike: "rent-nov" },
    });
    expect(result.isError).toBeFalsy();
    const [input] = vi.mocked(expenseService.create).mock.calls[0]!;
    expect(input.splitType).toBe("custom");
    expect(input.splits).toEqual([
      { userId: ME, amount: 38480 },
      { userId: SAM, amount: 13520 },
    ]);
  });
});

describe("create_expenses", () => {
  it("writes nothing when any line is invalid", async () => {
    const client = await connect();
    const result = await client.callTool({
      name: "create_expenses",
      arguments: {
        tab: "t-goa",
        expenses: [
          { description: "Milk", amount: 120 },
          { description: "Villa", amount: 9000, splitType: "percent", splits: [{ person: "Priya", percent: 100 }] },
        ],
      },
    });
    expect(result.isError).toBe(true);
    expect(text(result)).toContain("Line 2 (Villa)");
    expect(expenseService.createBulk).not.toHaveBeenCalled();
  });

  it("dry run previews without writing; real run writes atomically", async () => {
    vi.mocked(expenseService.createBulk).mockResolvedValue({
      success: true,
      data: { imported: 2, failed: 0, expenseIds: ["n1", "n2"] },
    } as never);
    const client = await connect();
    const args = {
      tab: "t-goa",
      expenses: [
        { description: "Milk", amount: 120 },
        { description: "Taxi", amount: 450, paidBy: "sam", date: "2026-11-25" },
      ],
    };
    const dry = await client.callTool({ name: "create_expenses", arguments: { ...args, dryRun: true } });
    expect(dry.isError).toBeFalsy();
    expect(text(dry)).toContain("Dry run: 2 expenses (570 INR)");
    expect(expenseService.createBulk).not.toHaveBeenCalled();

    const real = await client.callTool({ name: "create_expenses", arguments: args });
    expect(real.isError).toBeFalsy();
    expect(text(real)).toContain("Added 2 expenses");
    const [tabId, rows, by, opts] = vi.mocked(expenseService.createBulk).mock.calls[0]!;
    expect(tabId).toBe("t-goa");
    expect(by).toBe(ME);
    expect(opts).toEqual({ atomic: true });
    expect(rows[1]).toMatchObject({ description: "Taxi", amount: 450, paidById: SAM });
  });

  it("flags repeated lines inside one batch", async () => {
    const client = await connect();
    const result = await client.callTool({
      name: "create_expenses",
      arguments: { tab: "t-goa", expenses: [{ description: "Blinkit", amount: 640 }, { description: "Blinkit", amount: 640 }] },
    });
    expect(result.isError).toBe(true);
    expect(text(result)).toContain("sameAsLine");
    expect(expenseService.createBulk).not.toHaveBeenCalled();
  });
});

describe("get_settle_up", () => {
  it("lists only payments involving you across tabs", async () => {
    vi.mocked(tabService.getBalancesForTab).mockResolvedValue({
      success: true,
      data: [
        { participantId: "p-me", userId: ME, kind: "member", displayName: "Parth", amount: -250, user: samTab.members[0]!.user },
        { participantId: "p-sam", userId: SAM, kind: "member", displayName: "Sam Lee", amount: 250, user: samTab.members[1]!.user },
      ],
    } as never);
    const client = await connect();
    const result = await client.callTool({ name: "get_settle_up", arguments: {} });
    expect(result.isError).toBeFalsy();
    expect(text(result)).toContain("you pay Sam Lee 250 INR (You & Sam Lee)");
  });
});

describe("helpers", () => {
  it("dateRange uses local day bounds and inclusive ends", () => {
    expect(dateRange("2026-11-01", "2026-11-30", "Asia/Kolkata")).toEqual({
      from: new Date("2026-10-31T18:30:00.000Z"),
      to: new Date("2026-11-30T18:30:00.000Z"),
    });
    expect(dateRange("2026-12", undefined, "UTC")).toEqual({ from: new Date("2026-12-01T00:00:00.000Z") });
    expect(dateRange(undefined, "2026-12", "America/New_York")).toEqual({ to: new Date("2027-01-01T05:00:00.000Z") });
  });

  it("groups free-text descriptions", () => {
    expect(categoryKey("Blinkit 2.0")).toBe("blinkit");
    expect(categoryKey("The Blinkit diwali")).toBe("blinkit");
    expect(similarDescriptions("Dinner at Toit", "toit dinner")).toBe(true);
    expect(similarDescriptions("Rent", "Groceries")).toBe(false);
  });
});
