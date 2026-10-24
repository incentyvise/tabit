import { useCallback } from "react";
import { clearUserData } from "@/lib/session-cache";

export function useBustCache() {
  const bustCache = useCallback(async () => {
    await clearUserData();
    if ("caches" in window) {
      const names = await caches.keys();
      await Promise.all(names.map((name) => caches.delete(name)));
    }
    localStorage.clear();
    window.location.reload();
  }, []);

  return bustCache;
}
