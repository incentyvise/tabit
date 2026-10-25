import "@fontsource-variable/inter/wght.css";
import "./globals.css";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { RouterProvider, createRouter } from "@tanstack/react-router";
import { queryClient } from "./lib/query-client";
import { routeTree } from "./routeTree.gen";
import { initServiceWorker } from "./lib/sw-update";

const router = createRouter({
  routeTree,
  context: { queryClient },
  defaultPreload: "intent",
  // The document never scrolls (body is overflow:hidden); the app shell's
  // <main> does. Reset it on push navigation and restore it on back/forward.
  scrollRestoration: true,
  scrollToTopSelectors: ['[data-scroll-restoration-id="app-main"]'],
  // Short cross-fade between screens where supported (see globals.css);
  // skipped for users who prefer reduced motion.
  defaultViewTransition:
    typeof window === "undefined" ||
    !window.matchMedia("(prefers-reduced-motion: reduce)").matches,
});

// Registered before React renders so update checks also run on login/invite
// pages, and every screen change doubles as an update check.
initServiceWorker({
  onNavigation: (listener) => {
    router.subscribe("onResolved", listener);
  },
});

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}

const root = document.getElementById("root");
if (!root) throw new Error("Root element not found");

createRoot(root).render(
  <StrictMode>
    <RouterProvider router={router} />
  </StrictMode>,
);
