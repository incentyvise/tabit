/// <reference types="vite/client" />

import {
  cleanupOutdatedCaches,
  createHandlerBoundToURL,
  precacheAndRoute,
} from "workbox-precaching";
import { clientsClaim } from "workbox-core";
import {
  NavigationRoute,
  registerRoute,
  setCatchHandler,
} from "workbox-routing";
import { CacheFirst } from "workbox-strategies";
import type { WorkboxPlugin } from "workbox-core";
import { getLastCheckTime, setLastCheckTime } from "../lib/periodic-sync-store";
import { RpcHttpError, rpcCall } from "../lib/rpc-fetch";

declare let self: ServiceWorkerGlobalScope;

if (import.meta.env.DEV) {
  self.__WB_DISABLE_DEV_LOGS = true;
}

const PERIODIC_SYNC_TAG = "check-notifications";
const OFFLINE_SYNC_TAG = "sync-offline-mutations";

clientsClaim();

self.addEventListener("message", (event) => {
  if (event.data && event.data.type === "SKIP_WAITING") {
    self.skipWaiting();
  }
});

cleanupOutdatedCaches();
precacheAndRoute(self.__WB_MANIFEST);

// App-shell navigation. Server endpoints that may share the origin (dev proxy,
// health checks) must reach the network instead of getting index.html.
const allowlist = import.meta.env.DEV ? [/^\/$/] : undefined;
const denylist = [/^\/rpc(\/|$)/, /^\/api\//, /^\/healthz$/];
const handler = createHandlerBoundToURL("/index.html");
registerRoute(new NavigationRoute(handler, { allowlist, denylist }));

// Inter is self-hosted. Latin subsets are precached; other unicode-range
// subsets (Cyrillic, Greek, …) are fetched on demand and kept, since their
// hashed filenames never change content.
registerRoute(
  ({ request, url }) =>
    request.destination === "font" && url.origin === self.location.origin,
  new CacheFirst({
    cacheName: "fonts",
    plugins: [
      {
        cacheWillUpdate: async ({ response }) =>
          response.status === 200 ? response : null,
      } satisfies WorkboxPlugin,
    ],
  }),
);

// Only navigations get the offline page; a failed script/font must fail as
// itself (an HTML body would surface as a confusing MIME error).
setCatchHandler(async ({ request }) => {
  if (request.mode !== "navigate") return Response.error();
  return (
    (await caches.match("/offline.html")) ??
    new Response("Offline", { status: 503 })
  );
});

self.addEventListener("push", function (event) {
  const show = (function () {
    if (!event.data) return Promise.resolve();
    let data;
    try {
      data = event.data.json();
    } catch {
      return Promise.resolve();
    }
    const decl = data.notification;
    const title = decl?.title || data.title || "New notification";
    const body =
      decl?.body ||
      data.body ||
      (data.type === "friend_request"
        ? "New friend request"
        : data.type === "tab_invite"
          ? "New tab invite"
          : data.type === "poke"
            ? "Poke them back!"
            : data.type === "payment_reminder"
              ? "Open your tab to settle up."
              : "You have a new notification");
    const url =
      decl?.navigate ||
      data.url ||
      new URL(
        data.type === "tab_invite"
          ? "/tabs"
          : data.type === "payment_reminder" &&
              typeof data.friendTabId === "string"
            ? `/tabs/${data.friendTabId}`
            : "/friends",
        self.location.origin,
      ).href;
    const tag =
      data.type === "friend_request"
        ? "friend_request"
        : data.type === "tab_invite"
          ? "tab_invite"
          : data.type === "poke"
            ? "poke"
            : data.type === "payment_reminder"
              ? "payment_reminder"
              : "default";

    const actions =
      data.type === "friend_request" || data.type === "tab_invite"
        ? [
            { action: "accept", title: "Accept" },
            { action: "reject", title: "Reject" },
          ]
        : undefined;

    const options: NotificationOptions & {
      renotify?: boolean;
      vibrate?: number[];
    } = {
      body,
      icon: "/icon-192x192.png",
      tag,
      renotify: true,
      vibrate: [200, 100, 200],
      requireInteraction:
        data.type === "friend_request" ||
        data.type === "tab_invite" ||
        data.type === "poke" || data.type === "payment_reminder",
      data: { url, ...data },
      ...(actions && { actions }),
    };
    return self.registration
      .showNotification(title, options)
      .catch(function (err) {
        console.error("[SW] showNotification failed:", err);
      });
  })();
  event.waitUntil(show);
});

async function processSyncQueue(): Promise<void> {
  const clients = await self.clients.matchAll({ type: "window" });
  for (const client of clients) {
    client.postMessage({ type: "PROCESS_OFFLINE_QUEUE" });
  }
}

self.addEventListener("sync", (event: Event) => {
  const e = event as ExtendableEvent & { tag: string };
  if (e.tag === "sync-notifications" || e.tag === OFFLINE_SYNC_TAG) {
    e.waitUntil(processSyncQueue());
  }
});

async function processPeriodicSync(): Promise<void> {
  const lastCheck = await getLastCheckTime();
  const since = lastCheck || Date.now() - 24 * 60 * 60 * 1000;

  try {
    const data = await rpcCall<{
      friendRequests?: unknown[];
      tabInvites?: unknown[];
    }>(["notifications", "listMissed"], { since });
    if (!data || typeof data !== "object") return;

    type FriendRequestRow = {
      id: string;
      fromUserName?: string | null;
    };
    type TabInviteRow = {
      id: string;
      fromUserName?: string | null;
      tabName?: string;
    };

    const friendRequests =
      ((data as { friendRequests?: FriendRequestRow[] }).friendRequests ??
        []) as FriendRequestRow[];
    const tabInvites =
      ((data as { tabInvites?: TabInviteRow[] }).tabInvites ?? []) as TabInviteRow[];

    for (const r of friendRequests) {
      await self.registration.showNotification("New friend request", {
        body: r.fromUserName
          ? `${r.fromUserName} wants to be your friend`
          : "Someone wants to be your friend",
        icon: "/icon-192x192.png",
        tag: `friend_request_${r.id}`,
        data: {
          url: new URL("/friends", self.location.origin).href,
          type: "friend_request",
          requestId: r.id,
        },
      });
    }

    for (const r of tabInvites) {
      await self.registration.showNotification("Tab invite", {
        body: r.fromUserName
          ? `${r.fromUserName} invited you to ${r.tabName}`
          : `You were invited to ${r.tabName}`,
        icon: "/icon-192x192.png",
        tag: `tab_invite_${r.id}`,
        data: {
          url: new URL("/tabs", self.location.origin).href,
          type: "tab_invite",
          requestId: r.id,
        },
      });
    }

    await setLastCheckTime(Date.now());
  } catch {
    // Ignore fetch errors
  }
}

self.addEventListener("periodicsync", (event: Event) => {
  const e = event as ExtendableEvent & { tag: string };
  if (e.tag === PERIODIC_SYNC_TAG) {
    e.waitUntil(processPeriodicSync());
  }
});

self.addEventListener("notificationclick", function (event) {
  event.notification.close();
  const data = event.notification.data ?? {};
  const action = event.action;
  const requestId = data.requestId;

  if (
    requestId &&
    (action === "accept" || action === "reject") &&
    (data.type === "friend_request" || data.type === "tab_invite")
  ) {
    const isFriend = data.type === "friend_request";
    const procedure = [
      isFriend ? "friends" : "tabInvites",
      action === "accept" ? "acceptRequest" : "rejectRequest",
    ];
    const queueType =
      data.type === "friend_request"
        ? action === "accept"
          ? "accept_friend_request"
          : "reject_friend_request"
        : action === "accept"
          ? "accept_tab_invite"
          : "reject_tab_invite";

    event.waitUntil(
      (async () => {
        let executed = false;
        let rejected = false;
        if (navigator.onLine) {
          try {
            await rpcCall(procedure, { requestId });
            executed = true;
          } catch (err) {
            // A 4xx (already handled, expired, …) won't succeed later either.
            rejected =
              err instanceof RpcHttpError && err.status >= 400 && err.status < 500;
          }
        }

        if (!executed && !rejected) {
          const { enqueue } = await import("../lib/offline-queue");
          await enqueue({
            type: queueType,
            payload: { requestId },
          });
          if ("sync" in self.registration) {
            await (
              self.registration as ServiceWorkerRegistration & {
                sync: { register: (tag: string) => Promise<void> };
              }
            ).sync.register("sync-notifications");
          }
        }

        const title =
          action === "accept" ? "Request accepted" : "Request rejected";
        const body = executed
          ? "Done."
          : rejected
            ? "This request is no longer available."
            : "Your response will sync when you're back online.";
        await self.registration.showNotification(title, {
          body,
          icon: "/icon-192x192.png",
          tag: "action-feedback",
        });

        const url = data.url || new URL("/friends", self.location.origin).href;
        const targetUrl = url.startsWith("http")
          ? url
          : new URL(url, self.location.origin).href;
        const clientList = await self.clients.matchAll({
          type: "window",
          includeUncontrolled: true,
        });
        for (const client of clientList) {
          if (client.url.includes(self.location.origin) && "focus" in client) {
            await client.navigate(targetUrl);
            await client.focus();
            return;
          }
        }
        if (self.clients.openWindow) {
          await self.clients.openWindow(targetUrl);
        }
      })(),
    );
    return;
  }

  const url = data.url || new URL("/friends", self.location.origin).href;
  const targetUrl = url.startsWith("http")
    ? url
    : new URL(url, self.location.origin).href;
  event.waitUntil(
    self.clients
      .matchAll({ type: "window", includeUncontrolled: true })
      .then(async function (clientList) {
        for (const client of clientList) {
          if (client.url.includes(self.location.origin) && "focus" in client) {
            client.navigate(targetUrl);
            await client.focus();
            return;
          }
        }
        if (self.clients.openWindow) {
          await self.clients.openWindow(targetUrl);
        }
      }),
  );
});
