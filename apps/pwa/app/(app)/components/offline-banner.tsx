import { AnimatePresence, motion } from "framer-motion";
import { WifiOff } from "lucide-react";
import { useOnlineStatus } from "@/lib/use-online-status";

/** Floating notice under the top bar while the device has no connection. */
export function OfflineBanner() {
  const online = useOnlineStatus();

  return (
    <AnimatePresence>
      {!online && (
        <motion.div
          key="offline-banner"
          role="status"
          aria-live="polite"
          initial={{ opacity: 0, y: -8 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -8 }}
          transition={{ duration: 0.2 }}
          className="pointer-events-none fixed left-1/2 top-[calc(var(--app-bar-height)+var(--safe-top)+0.5rem)] z-50 -translate-x-1/2"
        >
          <div className="frosted-glass flex items-center gap-2 rounded-full bg-background/80 px-3 py-1.5 text-xs text-muted-foreground shadow-md ring-1 ring-border-subtle">
            <WifiOff className="h-3.5 w-3.5" aria-hidden />
            <span>You’re offline · showing saved data</span>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
