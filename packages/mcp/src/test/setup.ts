import { vi } from "vitest";

vi.mock("otel", () => ({
  log: vi.fn(),
  debug: vi.fn(),
  spanEvent: vi.fn(),
  withSpan: vi.fn(async (_name: string, _attrs: unknown, fn: (span: unknown) => unknown) =>
    fn({ setAttribute: vi.fn() }),
  ),
}));

vi.mock("data", () => ({
  tab: {
    getTabsForUser: vi.fn(),
    getDirectTabsForUser: vi.fn(),
    getWithMembers: vi.fn(),
  },
  user: { getById: vi.fn() },
  activity: { getForUser: vi.fn() },
  runWithWriteSource: vi.fn((_source: unknown, fn: () => unknown) => fn()),
  currentWriteSource: vi.fn(() => null),
}));

vi.mock("services", () => ({
  expenseService: {
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    restore: vi.fn(),
    getById: vi.fn(),
    getForTab: vi.fn(),
    getAuditLog: vi.fn(),
    createBulk: vi.fn(),
  },
  tabService: {
    getBalancesForTab: vi.fn(),
    getSettlementsForTab: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    createPlaceholder: vi.fn(),
  },
  settlementService: { record: vi.fn(), update: vi.fn(), delete: vi.fn(), getById: vi.fn() },
  friendService: {
    getPendingRequests: vi.fn(),
    sendRequest: vi.fn(),
    acceptRequest: vi.fn(),
    rejectRequest: vi.fn(),
    poke: vi.fn(),
    sendPaymentReminder: vi.fn(),
  },
  tabInviteService: {
    getPendingRequests: vi.fn(),
    sendRequest: vi.fn(),
    acceptRequest: vi.fn(),
    rejectRequest: vi.fn(),
  },
  recurringExpenseService: {
    listForTab: vi.fn(),
    getById: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    deleteRule: vi.fn(),
  },
  convertToTabCurrency: vi.fn(),
}));
