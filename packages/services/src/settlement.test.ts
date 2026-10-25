import { describe, test, expect, vi, beforeEach } from "vitest";
import { settlementService } from "./settlement.js";
import { tab, settlement, user as userData } from "data";
import { notificationService } from "./notification.js";

const tabWithMembers = {
  id: "tab1",
  name: "Test Tab",
  currency: "USD",
  isDirect: false,
  createdAt: new Date(),
  members: [
    { userId: "user1", role: "member", user: { id: "user1", email: "u1@test.com", name: "User 1", username: "user1" } },
    { userId: "user2", role: "member", user: { id: "user2", email: "u2@test.com", name: "User 2", username: "user2" } },
  ],
  participants: [
    {
      id: "pid-user1",
      kind: "member",
      userId: "user1",
      displayName: "User 1",
      user: { id: "user1", email: "u1@test.com", name: "User 1", username: "user1" },
    },
    {
      id: "pid-user2",
      kind: "member",
      userId: "user2",
      displayName: "User 2",
      user: { id: "user2", email: "u2@test.com", name: "User 2", username: "user2" },
    },
  ],
};

describe("settlementService", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("getForTab", () => {
    test("returns error if tab not found", async () => {
      vi.mocked(tab.getWithMembers).mockResolvedValue(null);

      const result = await settlementService.getForTab("tab1", "user1");

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error).toBe("Tab not found");
        expect(result.status).toBe(404);
      }
    });

    test("returns error if user is not a member", async () => {
      vi.mocked(tab.getWithMembers).mockResolvedValue({
        ...tabWithMembers,
        members: [{ userId: "user2", role: "member", user: { id: "user2", email: "u2@test.com", name: "User 2", username: "user2" } }],
        participants: [
          {
            id: "pid-user2",
            kind: "member",
            userId: "user2",
            displayName: "User 2",
            user: { id: "user2", email: "u2@test.com", name: "User 2", username: "user2" },
          },
        ],
      });

      const result = await settlementService.getForTab("tab1", "user1");

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error).toBe("Not a member");
        expect(result.status).toBe(403);
      }
    });

    test("returns settlements if user is a member", async () => {
      vi.mocked(tab.getWithMembers).mockResolvedValue(tabWithMembers);
      vi.mocked(settlement.getForTab).mockResolvedValue([]);

      const result = await settlementService.getForTab("tab1", "user1");

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data).toEqual([]);
      }
    });
  });

  describe("getById", () => {
    test("returns error if user is not a member", async () => {
      vi.mocked(tab.getWithMembers).mockResolvedValue({
        ...tabWithMembers,
        members: [{ userId: "user2", role: "member", user: { id: "user2", email: "u2@test.com", name: "User 2", username: "user2" } }],
        participants: [
          {
            id: "pid-user2",
            kind: "member",
            userId: "user2",
            displayName: "User 2",
            user: { id: "user2", email: "u2@test.com", name: "User 2", username: "user2" },
          },
        ],
      });

      const result = await settlementService.getById("tab1", "set1", "user1");

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error).toBe("Not a member");
      }
    });

    test("returns error if settlement not found", async () => {
      vi.mocked(tab.getWithMembers).mockResolvedValue(tabWithMembers);
      vi.mocked(settlement.getById).mockResolvedValue(null);

      const result = await settlementService.getById("tab1", "set1", "user1");

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error).toBe("Settlement not found");
      }
    });
  });

  describe("record", () => {
    test("returns error if user is not a member", async () => {
      vi.mocked(tab.isMember).mockResolvedValue(false);

      const result = await settlementService.record("tab1", "user1", "user2", 50, "user1");

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error).toBe("Not a member");
        expect(result.status).toBe(403);
      }
    });

    test("returns error if fromUser not a member", async () => {
      // Keyed on userId (not call order) so this can't leak into other tests
      // via leftover queued mockResolvedValueOnce calls.
      vi.mocked(tab.isMember).mockImplementation(async (_tabId, userId) => userId !== "user3");

      const result = await settlementService.record("tab1", "user3", "user2", 50, "user1");

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error).toBe("Payer must be a tab member when paying as a user");
      }
    });

    test("returns error if toUser not a member", async () => {
      vi.mocked(tab.isMember).mockImplementation(async (_tabId, userId) => userId !== "user3");

      const result = await settlementService.record("tab1", "user1", "user3", 50, "user1");

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error).toBe("Payee must be a tab member when receiving as a user");
      }
    });

    test("returns error if same user", async () => {
      vi.mocked(tab.isMember).mockResolvedValue(true);

      const result = await settlementService.record("tab1", "user1", "user1", 50, "user1");

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error).toBe("Payer and payee must be different people");
      }
    });

    test("success path: record settlement", async () => {
      vi.mocked(tab.isMember).mockResolvedValue(true);

      const result = await settlementService.record("tab1", "user1", "user2", 50, "user1");

      expect(result.success).toBe(true);
      expect(settlement.record).toHaveBeenCalledWith({
        tabId: "tab1",
        fromUserId: "user1",
        toUserId: "user2",
        fromParticipantId: "pid-user1",
        toParticipantId: "pid-user2",
        amount: 50,
        currency: null,
        originalAmount: null,
        settlementDate: expect.any(Date),
        performedById: "user1",
      });
    });
  });

  describe("update", () => {
    test("returns error if settlement not found", async () => {
      vi.mocked(settlement.getById).mockResolvedValue(null);

      const result = await settlementService.update(
        "tab1",
        "set1",
        "user1",
        "user2",
        50,
        "user1",
      );

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error).toBe("Settlement not found");
      }
    });

    test("returns error if user is not a member", async () => {
      vi.mocked(settlement.getById).mockResolvedValue({
        id: "set1",
        tabId: "tab1",
        fromUserId: "user1",
        toUserId: "user2",
        fromParticipantId: "pid-user1",
        toParticipantId: "pid-user2",
        amount: 50,
        currency: null,
        originalAmount: null,
        settlementDate: new Date("2024-06-01"),
        createdAt: new Date(),
        fromUser: { id: "user1", email: "u1@test.com", name: "User 1", username: "user1" },
        toUser: { id: "user2", email: "u2@test.com", name: "User 2", username: "user2" },
      });
      vi.mocked(tab.isMember).mockResolvedValue(false);

      const result = await settlementService.update(
        "tab1",
        "set1",
        "user1",
        "user2",
        60,
        "user1",
      );

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error).toBe("Not a member");
      }
    });

    test("success path: update settlement", async () => {
      vi.mocked(settlement.getById).mockResolvedValue({
        id: "set1",
        tabId: "tab1",
        fromUserId: "user1",
        toUserId: "user2",
        fromParticipantId: "pid-user1",
        toParticipantId: "pid-user2",
        amount: 50,
        currency: null,
        originalAmount: null,
        settlementDate: new Date("2024-06-01"),
        createdAt: new Date(),
        fromUser: { id: "user1", email: "u1@test.com", name: "User 1", username: "user1" },
        toUser: { id: "user2", email: "u2@test.com", name: "User 2", username: "user2" },
      });
      vi.mocked(tab.isMember).mockResolvedValue(true);

      const result = await settlementService.update(
        "tab1",
        "set1",
        "user1",
        "user2",
        60,
        "user1",
      );

      expect(result.success).toBe(true);
      expect(settlement.update).toHaveBeenCalledWith("set1", "tab1", {
        fromUserId: "user1",
        toUserId: "user2",
        fromParticipantId: "pid-user1",
        toParticipantId: "pid-user2",
        amount: 60,
        currency: null,
        originalAmount: null,
        settlementDate: new Date("2024-06-01"),
        performedById: "user1",
      });
    });
  });

  describe("delete", () => {
    test("returns error if settlement not found", async () => {
      vi.mocked(settlement.getById).mockResolvedValue(null);

      const result = await settlementService.delete("tab1", "set1", "user1");

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error).toBe("Settlement not found");
      }
    });

    test("returns error if user is not a member", async () => {
      vi.mocked(settlement.getById).mockResolvedValue({
        id: "set1",
        tabId: "tab1",
        fromUserId: "user1",
        toUserId: "user2",
        fromParticipantId: "pid-user1",
        toParticipantId: "pid-user2",
        amount: 50,
        currency: null,
        originalAmount: null,
        settlementDate: new Date("2024-06-01"),
        createdAt: new Date(),
        fromUser: { id: "user1", email: "u1@test.com", name: "User 1", username: "user1" },
        toUser: { id: "user2", email: "u2@test.com", name: "User 2", username: "user2" },
      });
      vi.mocked(tab.isMember).mockResolvedValue(false);

      const result = await settlementService.delete("tab1", "set1", "user1");

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error).toBe("Not a member");
      }
    });
  });

  describe("realtime notifications", () => {
    const tabInfo = { name: "Trip", isDirect: false, currency: "USD", displayName: "Trip" };

    beforeEach(() => {
      vi.mocked(tab.isMember).mockResolvedValue(true);
      vi.mocked(tab.getMembers).mockResolvedValue([
        { userId: "user1", role: "member" },
        { userId: "user2", role: "member" },
        { userId: "user3", role: "member" },
      ]);
      vi.mocked(tab.getTabInfoForNotifications).mockResolvedValue(tabInfo);
      vi.mocked(userData.getById).mockResolvedValue({ id: "user1", name: "User 1" } as never);
      vi.mocked(settlement.record).mockResolvedValue("set-new");
    });

    test("record notifies every other member; only the payee is flagged for push", async () => {
      const result = await settlementService.record("tab1", "user1", "user2", 25, "user1");

      expect(result.success).toBe(true);
      const publish = vi.mocked(notificationService.publishSettlementChangedToUser);
      expect(publish).toHaveBeenCalledTimes(2);
      const byUser = Object.fromEntries(publish.mock.calls.map(([uid, p]) => [uid, p]));
      expect(byUser.user1).toBeUndefined();
      expect(byUser.user2).toMatchObject({
        action: "recorded",
        settlementId: "set-new",
        tabId: "tab1",
        amount: "25.00",
        payerName: "user1",
        payeeName: "user2",
        involvesRecipient: true,
      });
      expect(byUser.user3).toMatchObject({ involvesRecipient: false });
    });

    test("delete notifies other members with action deleted", async () => {
      vi.mocked(settlement.getById).mockResolvedValue({
        id: "set1",
        tabId: "tab1",
        fromUserId: "user2",
        toUserId: "user3",
        fromParticipantId: "pid-user2",
        toParticipantId: "pid-user3",
        amount: 10,
        currency: null,
        originalAmount: null,
        settlementDate: new Date("2024-06-01"),
        createdAt: new Date(),
        fromUser: null,
        toUser: null,
      } as never);

      const result = await settlementService.delete("tab1", "set1", "user1");

      expect(result.success).toBe(true);
      const publish = vi.mocked(notificationService.publishSettlementChangedToUser);
      expect(publish.mock.calls.map(([uid]) => uid).sort()).toEqual(["user2", "user3"]);
      expect(publish.mock.calls[0]![1]).toMatchObject({ action: "deleted", involvesRecipient: true });
    });

    test("a notification failure does not fail the mutation", async () => {
      vi.mocked(tab.getMembers).mockRejectedValue(new Error("db down"));

      const result = await settlementService.record("tab1", "user1", "user2", 25, "user1");

      expect(result.success).toBe(true);
      expect(notificationService.publishSettlementChangedToUser).not.toHaveBeenCalled();
    });
  });
});
