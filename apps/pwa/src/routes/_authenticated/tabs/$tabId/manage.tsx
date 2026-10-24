import { createFileRoute } from "@tanstack/react-router";
import { prefetchTabMeta } from "@/src/lib/route-loaders";
import { TabManagePage } from "@/app/(app)/tabs/[tabId]/manage/page";

export const Route = createFileRoute("/_authenticated/tabs/$tabId/manage")({
  loader: ({ context, params }) =>
    prefetchTabMeta(context.queryClient, params.tabId),
  component: TabManagePage,
});
