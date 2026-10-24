import { createFileRoute } from "@tanstack/react-router";
import { prefetchTabMeta } from "@/src/lib/route-loaders";
import { TabMembersPage } from "@/app/(app)/tabs/[tabId]/members/page";

export const Route = createFileRoute("/_authenticated/tabs/$tabId/members")({
  loader: ({ context, params }) =>
    prefetchTabMeta(context.queryClient, params.tabId),
  component: TabMembersPage,
});
