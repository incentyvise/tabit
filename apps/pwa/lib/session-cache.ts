import { authClient } from "@/lib/auth-client";
import { clear as clearOfflineQueue } from "@/lib/offline-queue";
import { persister } from "@/src/lib/persister";
import { queryClient } from "@/src/lib/query-client";

const LAST_USER_KEY = "tabit:lastUserId";

/** Drop every trace of the current user's data (memory, IndexedDB, offline queue). */
export async function clearUserData(): Promise<void> {
  await queryClient.cancelQueries();
  queryClient.clear();
  await Promise.allSettled([persister.removeClient(), clearOfflineQueue()]);
}

export async function signOutAndClear(): Promise<void> {
  try {
    await authClient.signOut();
  } finally {
    await clearUserData();
    try {
      localStorage.removeItem(LAST_USER_KEY);
    } catch {
      // storage unavailable
    }
    window.location.replace("/login");
  }
}

/**
 * Guard against a cache restored from a different account (e.g. the session
 * expired and another user signed in on a shared device).
 */
export async function ensureCacheOwner(userId: string): Promise<void> {
  let previous: string | null = null;
  try {
    previous = localStorage.getItem(LAST_USER_KEY);
    localStorage.setItem(LAST_USER_KEY, userId);
  } catch {
    return;
  }
  if (previous && previous !== userId) {
    await clearUserData();
  }
}
