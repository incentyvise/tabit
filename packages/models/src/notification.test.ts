import { describe, expect, test } from "vitest";
import {
  createSettlementChangedNotificationPayload,
  getPaymentReminderPushCopy,
  notificationPayloadSchema,
} from "./notification.js";

describe("settlement_changed payload", () => {
  const payload = createSettlementChangedNotificationPayload({
    action: "recorded",
    tabId: "t1",
    settlementId: "s1",
    tabName: "Trip",
    fromUserId: "u1",
    fromUserName: "Alice",
    payerName: "Alice",
    payeeName: "Bob",
    amount: "12.50",
    currencySymbol: "$",
    involvesRecipient: true,
    createdAt: new Date("2026-01-02T03:04:05Z"),
  });

  test("serializes createdAt and round-trips through the union schema", () => {
    expect(payload.createdAt).toBe("2026-01-02T03:04:05.000Z");
    expect(notificationPayloadSchema.parse(payload)).toEqual(payload);
  });

  test("rejects an unknown action", () => {
    expect(
      notificationPayloadSchema.safeParse({ ...payload, action: "voided" }).success,
    ).toBe(false);
  });
});

describe("getPaymentReminderPushCopy", () => {
  test("falls back to the gentle tone and default names", () => {
    const copy = getPaymentReminderPushCopy("not-a-tone", null, "");
    expect(copy.title).toBe("Soft reminder from Someone");
    expect(copy.body).toContain("a balance");
  });

  test("includes the amount", () => {
    expect(getPaymentReminderPushCopy("blunt", "Bob", "$5").title).toBe("You owe $5");
  });
});
