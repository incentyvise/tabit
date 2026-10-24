import { toast } from "sonner";
import { api } from "./api";
import { invalidateMembership } from "./queries";
import { queryClient } from "@/src/lib/query-client";
import { dequeue, putBack, type OfflineAction } from "./offline-queue";

type CallResult =
  | { success: true }
  | { success: false; error: string; status?: number };

const LABELS: Record<OfflineAction["type"], string> = {
  accept_friend_request: "Could not accept friend request",
  reject_friend_request: "Could not reject friend request",
  accept_tab_invite: "Could not accept tab invite",
  reject_tab_invite: "Could not reject tab invite",
};

function run(action: OfflineAction): Promise<CallResult> {
  const requestId = action.payload.requestId as string;
  switch (action.type) {
    case "accept_friend_request":
      return api.friends.acceptRequest(requestId);
    case "reject_friend_request":
      return api.friends.rejectRequest(requestId);
    case "accept_tab_invite":
      return api.tabInvites.acceptRequest(requestId);
    case "reject_tab_invite":
      return api.tabInvites.rejectRequest(requestId);
  }
}

/** true = finished (succeeded or permanently rejected), false = retry later. */
async function processAction(action: OfflineAction): Promise<boolean> {
  const result = await run(action);
  if (result.success) return true;
  // No HTTP status means the request never reached the server (offline, DNS,
  // CORS…): keep it queued. 5xx may also be transient.
  if (result.status === undefined || result.status >= 500) return false;
  toast.error(result.error || LABELS[action.type]);
  return true;
}

let inFlight: Promise<void> | null = null;

/** Single-flight: `online` and the SW sync message can fire together. */
export function processOfflineQueue(): Promise<void> {
  inFlight ??= drain().finally(() => {
    inFlight = null;
  });
  return inFlight;
}

async function drain(): Promise<void> {
  const retryLater: OfflineAction[] = [];
  let processed = 0;
  let action = await dequeue();
  while (action) {
    let done = false;
    try {
      done = await processAction(action);
    } catch {
      done = false;
    }
    if (done) processed += 1;
    else retryLater.push(action);
    action = await dequeue();
  }
  // Re-queue after draining so a failing action isn't retried in a tight loop.
  for (const a of retryLater) await putBack(a);
  if (processed > 0) await invalidateMembership(queryClient);
}

export function registerOfflineSyncListeners(): () => void {
  if (typeof window === "undefined") return () => {};

  const onOnline = () => void processOfflineQueue();
  const onMessage = (event: MessageEvent) => {
    if (event.data?.type === "PROCESS_OFFLINE_QUEUE") {
      void processOfflineQueue();
    }
  };
  window.addEventListener("online", onOnline);
  navigator.serviceWorker?.addEventListener("message", onMessage);
  return () => {
    window.removeEventListener("online", onOnline);
    navigator.serviceWorker?.removeEventListener("message", onMessage);
  };
}
