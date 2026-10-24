import { QueryClient } from "@tanstack/react-query";
import { shouldRetryQuery } from "@/lib/queries";

/** Persisted cache lifetime; gcTime must be >= this or entries are GC'd before they can be restored. */
export const PERSIST_MAX_AGE = 1000 * 60 * 60 * 24 * 7;

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // Realtime socket events + mutation invalidation keep data fresh; a short
      // staleTime only causes refetch storms on every app switch.
      staleTime: 1000 * 60 * 5,
      gcTime: PERSIST_MAX_AGE,
      refetchOnWindowFocus: true,
      refetchOnMount: true,
      retry: shouldRetryQuery,
    },
  },
});
