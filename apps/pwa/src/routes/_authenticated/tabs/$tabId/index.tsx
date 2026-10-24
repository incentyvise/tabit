import { createFileRoute } from "@tanstack/react-router";
import { prefetchTab } from "@/src/lib/route-loaders";
import { TabPage } from "@/app/(app)/tabs/[tabId]/page";

export const Route = createFileRoute("/_authenticated/tabs/$tabId/")({
  loader: ({ context, params }) =>
    prefetchTab(context.queryClient, params.tabId),
  // Fresh component state (filter, search, placeholder data) per tab.
  remountDeps: ({ params }) => params.tabId,
  component: TabPage,
});
