import { QueryClient } from "@tanstack/react-query";

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      refetchOnWindowFocus: true,
      retry: (count, error) => {
        const status = (error as { status?: number }).status;
        if (status === 401 || status === 403 || status === 404) return false;
        return count < 2;
      },
    },
  },
});
