import { describe, expect, test } from "vitest";
import {
  autoMatchMemberColumns,
  buildExpensePayload,
  formatDateLocal,
  getMemberColumnDisplayName,
  parseCsvFile,
  validateRow,
  type ParsedCsvRow,
} from "./csv-import";

const CSV = [
  "Date,Description,Category,Cost,Currency,Alice,Bob",
  "2024-04-15,Dinner,Food,30.00,USD,15.00,-15.00",
  "2024-04-16,Taxi,Transport,12.50,USD,-12.50,12.50",
  ",,,,,,",
  "2024-04-17,Total balance,,,USD,2.50,-2.50",
].join("\n");

function row(overrides: Partial<ParsedCsvRow>): ParsedCsvRow {
  return {
    date: new Date(2024, 3, 15),
    description: "Dinner",
    cost: 30,
    currency: "USD",
    memberAmounts: { Alice: 15, Bob: -15 },
    rowIndex: 1,
    ...overrides,
  };
}

describe("parseCsvFile", () => {
  test("reads Splitwise rows and member columns", () => {
    const parsed = parseCsvFile(CSV);
    expect(parsed.memberColumns).toEqual(["Alice", "Bob"]);
    const dinner = parsed.rows.find((r) => r.description === "Dinner");
    expect(dinner).toBeDefined();
    expect(dinner!.cost).toBe(30);
    expect(dinner!.memberAmounts).toEqual({ Alice: 15, Bob: -15 });
    expect(formatDateLocal(dinner!.date!)).toBe("2024-04-15");
  });
});

describe("getMemberColumnDisplayName", () => {
  test("strips the Net balance wrapper", () => {
    expect(getMemberColumnDisplayName("Net balance (Alice)")).toBe("Alice");
    expect(getMemberColumnDisplayName("Bob")).toBe("Bob");
  });
});

describe("autoMatchMemberColumns", () => {
  test("matches columns to members by name", () => {
    const members = [
      { userId: "u1", user: { name: "Alice", username: "alice", email: "a@x.com" } },
      { userId: "u2", user: { name: "Bob", username: "bob", email: "b@x.com" } },
    ];
    const result = autoMatchMemberColumns(
      ["Alice", "Bob"],
      members,
    );
    expect(result).toMatchObject({ Alice: "u1", Bob: "u2" });
  });
});

describe("validateRow", () => {
  const cols = { Alice: "u1", Bob: "u2" };

  test("valid single-payer row produces payer and splits", () => {
    const v = validateRow(row({}), cols);
    expect(v).toEqual({
      valid: true,
      payerUserId: "u1",
      splits: [
        { userId: "u1", amount: 15 },
        { userId: "u2", amount: 15 },
      ],
    });
  });

  test("rejects non-positive cost", () => {
    expect(validateRow(row({ cost: 0 }), cols)).toMatchObject({ valid: false });
  });

  test("rejects missing description", () => {
    expect(validateRow(row({ description: "" }), cols).error).toBe(
      "Description is required",
    );
  });

  test("rejects multiple payers", () => {
    const v = validateRow(
      row({ cost: 30, memberAmounts: { Alice: 10, Bob: 10 } }),
      { ...cols },
    );
    expect(v.valid).toBe(false);
  });

  test("rejects split sums that don't match the cost", () => {
    const v = validateRow(row({ cost: 30, memberAmounts: { Alice: 15, Bob: -5 } }), cols);
    expect(v.valid).toBe(false);
    expect(v.error).toMatch(/does not match cost/);
  });

  test("columns mapped to the same user are aggregated", () => {
    const v = validateRow(
      row({ cost: 30, memberAmounts: { Alice: 15, Bob: -10, Carol: -5 } }),
      { Alice: "u1", Bob: "u2", Carol: "u2" },
    );
    expect(v.valid).toBe(true);
    expect(v.splits).toContainEqual({ userId: "u2", amount: 15 });
  });
});

describe("buildExpensePayload", () => {
  test("builds a custom-split payload with local date", () => {
    const r = row({});
    const payload = buildExpensePayload(r, validateRow(r, { Alice: "u1", Bob: "u2" }), "fallback");
    expect(payload).toMatchObject({
      amount: 30,
      currency: "USD",
      description: "Dinner",
      paidById: "u1",
      splitType: "custom",
      expenseDate: "2024-04-15",
    });
  });
});
