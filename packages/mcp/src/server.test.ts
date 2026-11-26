import { describe, it, expect, beforeEach, vi } from "vitest";
import { Client } from "@modelcontextprotocol/client";
import { InMemoryTransport } from "@modelcontextprotocol/server";
import { tab, user, runWithWriteSource } from "data";
import { expenseService, settlementService, tabService, friendService } from "services";
import { createTabMcpServer } from "./server.js";

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
});

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
