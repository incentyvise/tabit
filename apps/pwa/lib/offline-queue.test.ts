import { beforeEach, describe, expect, test, vi } from "vitest";

// In-memory stand-in for IndexedDB.
const memory = new Map<string, unknown>();
vi.mock("idb-keyval", () => ({
  createStore: () => "store",
  get: async (key: string) => memory.get(key),
  set: async (key: string, value: unknown) => {
    memory.set(key, structuredClone(value));
  },
}));

const queue = await import("./offline-queue");

beforeEach(() => {
  memory.clear();
  vi.stubGlobal("window", {});
});

describe("offline queue", () => {
  test("enqueue/dequeue is FIFO", async () => {
    await queue.enqueue({ type: "accept_friend_request", payload: { requestId: "a" } });
    await queue.enqueue({ type: "reject_tab_invite", payload: { requestId: "b" } });

    expect((await queue.dequeue())?.payload).toEqual({ requestId: "a" });
    expect((await queue.dequeue())?.payload).toEqual({ requestId: "b" });
    expect(await queue.dequeue()).toBeNull();
  });

  test("putBack retries up to the limit, then drops the action", async () => {
    await queue.enqueue({ type: "accept_tab_invite", payload: { requestId: "x" } });

    for (let i = 0; i < 2; i++) {
      const action = await queue.dequeue();
      expect(action).not.toBeNull();
      await queue.putBack(action!);
    }
    const last = await queue.dequeue();
    expect(last?.retries).toBe(2);
    await queue.putBack(last!);

    expect(await queue.getAll()).toEqual([]);
  });

  test("remove and clear", async () => {
    await queue.enqueue({ type: "accept_friend_request", payload: { requestId: "1" } });
    await queue.enqueue({ type: "accept_friend_request", payload: { requestId: "2" } });
    const [first] = await queue.getAll();

    await queue.remove(first!.id);
    expect((await queue.getAll()).map((a) => a.payload.requestId)).toEqual(["2"]);

    await queue.clear();
    expect(await queue.getAll()).toEqual([]);
  });

  test("is a no-op outside the browser", async () => {
    vi.unstubAllGlobals();
    await queue.enqueue({ type: "accept_friend_request", payload: { requestId: "z" } });
    expect(await queue.getAll()).toEqual([]);
  });
});
