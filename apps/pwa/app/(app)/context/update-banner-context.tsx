import {
  applyUpdate,
  useSwUpdateStore,
} from "@/src/lib/sw-update";

/** Service-worker update state (see src/lib/sw-update.ts). */
export function useUpdateBanner() {
  const needRefresh = useSwUpdateStore((s) => s.needRefresh);
  const updating = useSwUpdateStore((s) => s.updating);
  return { needRefresh, updating, applyUpdate };
}
