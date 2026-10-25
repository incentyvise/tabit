import { registerSW } from "virtual:pwa-register";
import { create } from "zustand";

/**
 * Service worker lifecycle for the whole app (one registration, started from
 * main.tsx — not tied to any route or React tree).
 *
 * Invariants:
 * - A page never keeps running under a worker from a different build: when a
 *   new worker takes over a page that already had a controller, reload once.
 * - Updates are found quickly even in iOS home-screen apps, which are resumed
 *   (not relaunched) and whose timers freeze in the background.
 * - A stale page that fails to load a code chunk heals itself with at most one
 *   reload.
 */

type SwUpdateState = {
  /** A new build is installed and waiting for the user to apply it. */
  needRefresh: boolean;
  /** "Update now" was tapped; waiting for the new worker to take over. */
  updating: boolean;
};

export const useSwUpdateStore = create<SwUpdateState>(() => ({
  needRefresh: false,
  updating: false,
}));

const CHECK_THROTTLE_MS = 60_000;
const CHECK_INTERVAL_MS = 30 * 60_000;
const RECOVERY_KEY = "tab:stale-build-recovery-at";
const RECOVERY_COOLDOWN_MS = 30_000;

let registration: ServiceWorkerRegistration | undefined;
let lastCheckAt = 0;
let started = false;
let reloading = false;

function reloadOnce() {
  if (reloading) return;
  reloading = true;
  window.location.reload();
}

function markWaiting() {
  useSwUpdateStore.setState({ needRefresh: true });
}

/** Ask the browser to re-fetch sw.js (byte-compared; no-op when unchanged). */
export async function checkForUpdate({ force = false } = {}): Promise<void> {
  const reg = registration;
  if (!reg || !navigator.onLine || reg.installing) return;
  if (reg.waiting) {
    markWaiting();
    return;
  }
  const now = Date.now();
  if (!force && now - lastCheckAt < CHECK_THROTTLE_MS) return;
  lastCheckAt = now;
  try {
    await reg.update();
  } catch {
    // Offline / server unreachable: try again on the next trigger.
  }
}

function waitForInstalled(sw: ServiceWorker, timeoutMs: number) {
  return new Promise<void>((resolve) => {
    if (sw.state !== "installing") return resolve();
    const timer = window.setTimeout(resolve, timeoutMs);
    sw.addEventListener("statechange", function onChange() {
      if (sw.state === "installing") return;
      sw.removeEventListener("statechange", onChange);
      window.clearTimeout(timer);
      resolve();
    });
  });
}

/** Apply the waiting update. The controllerchange guard performs the reload. */
export function applyUpdate(): void {
  const waiting = registration?.waiting;
  useSwUpdateStore.setState({ needRefresh: false, updating: true });
  if (!waiting) {
    reloadOnce();
    return;
  }
  waiting.postMessage({ type: "SKIP_WAITING" });
  // Only if the worker died instead of activating (never reload while it is
  // still activating: that would load the old shell under the new worker).
  window.setTimeout(() => {
    if (waiting.state === "redundant") reloadOnce();
  }, 10_000);
}

/**
 * The running build is out of date (missing chunk, unknown route). Activate the
 * newest build if the server has one, then reload — at most once per cooldown
 * so a genuinely broken deploy cannot cause a reload loop.
 *
 * Returns false when recovery was already attempted recently.
 */
function recoveryOnCooldown(): boolean {
  try {
    const last = Number(sessionStorage.getItem(RECOVERY_KEY) ?? 0);
    return Date.now() - last < RECOVERY_COOLDOWN_MS;
  } catch {
    return false;
  }
}

export async function recoverFromStaleBuild({
  onlyIfNewer = false,
}: { onlyIfNewer?: boolean } = {}): Promise<boolean> {
  if (recoveryOnCooldown()) return false;

  // Early in startup registerSW may not have resolved yet; an installed app
  // already has a registration we can use.
  const reg =
    registration ??
    (await navigator.serviceWorker?.getRegistration().catch(() => undefined));
  registration ??= reg;
  if (reg) {
    if (!reg.waiting) await checkForUpdate({ force: true });
    if (reg.installing) await waitForInstalled(reg.installing, 15_000);
  }
  const waiting = reg?.waiting;
  if (onlyIfNewer && !waiting) return false;

  try {
    sessionStorage.setItem(RECOVERY_KEY, String(Date.now()));
  } catch {
    // ignore
  }
  if (waiting) {
    applyUpdate();
  } else {
    reloadOnce();
  }
  return true;
}

export function initServiceWorker(options: {
  onNavigation: (listener: () => void) => void;
}): void {
  if (started || typeof window === "undefined") return;
  started = true;

  // Chunk/dynamic-import failures from Vite's preload helper (stale build).
  // On cooldown, let the error propagate so the router shows its error UI
  // instead of reloading forever.
  window.addEventListener("vite:preloadError", (event) => {
    if (recoveryOnCooldown()) return;
    event.preventDefault();
    void recoverFromStaleBuild();
  });

  if (!("serviceWorker" in navigator)) return;

  let controller = navigator.serviceWorker.controller;
  navigator.serviceWorker.addEventListener("controllerchange", () => {
    const previous = controller;
    controller = navigator.serviceWorker.controller;
    // First install (clientsClaim) on a fresh page: same build, no reload.
    if (previous) reloadOnce();
  });

  registerSW({
    immediate: true,
    onNeedRefresh: markWaiting,
    onRegisteredSW(_swUrl, reg) {
      registration = reg;
      if (reg?.waiting) markWaiting();
      void checkForUpdate({ force: true });
    },
  });

  const check = () => void checkForUpdate();
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") check();
  });
  window.addEventListener("pageshow", check);
  window.addEventListener("focus", check);
  window.addEventListener("online", check);
  window.setInterval(check, CHECK_INTERVAL_MS);
  options.onNavigation(check);
}

/**
 * Ask the browser not to evict the offline cache. Safari and Chromium grant it
 * silently for installed apps; skipped in a regular browser tab (Firefox would
 * prompt).
 */
export async function requestPersistentStorage(): Promise<void> {
  const standalone =
    window.matchMedia?.("(display-mode: standalone)").matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true;
  if (!standalone || !navigator.storage?.persist) return;
  try {
    if (!(await navigator.storage.persisted())) await navigator.storage.persist();
  } catch {
    // unsupported / denied
  }
}
