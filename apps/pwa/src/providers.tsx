import "ios-vibrator-pro-max";
import { useEffect } from "react";
import { ThemeProvider } from "next-themes";
import { MotionConfig } from "framer-motion";
import { PersistQueryClientProvider } from "@tanstack/react-query-persist-client";
import { defaultShouldDehydrateQuery } from "@tanstack/react-query";
import { registerGlobalTapHaptic } from "@/lib/vibrate";
import { NON_PERSISTED_KEY_ROOTS } from "@/lib/queries";
import { PERSIST_MAX_AGE, queryClient } from "./lib/query-client";
import { persister } from "./lib/persister";

/**
 * Bump when a persisted query's data shape changes. Deliberately not the build
 * time: busting on every deploy would wipe the offline cache after each update.
 */
const CACHE_BUSTER = import.meta.env.VITE_QUERY_CACHE_BUSTER ?? "2";

export function Providers({ children }: { children: React.ReactNode }) {
  useEffect(() => registerGlobalTapHaptic(), []);

  return (
    <ThemeProvider
      attribute="class"
      defaultTheme="dark"
      enableSystem
      disableTransitionOnChange
    >
      <PersistQueryClientProvider
        client={queryClient}
        persistOptions={{
          persister,
          maxAge: PERSIST_MAX_AGE,
          buster: CACHE_BUSTER,
          dehydrateOptions: {
            shouldDehydrateQuery: (query) =>
              defaultShouldDehydrateQuery(query) &&
              !NON_PERSISTED_KEY_ROOTS.has(query.queryKey[0]),
          },
        }}
      >
        <MotionConfig reducedMotion="user">{children}</MotionConfig>
      </PersistQueryClientProvider>
    </ThemeProvider>
  );
}
