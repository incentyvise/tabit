import { useEffect } from "react";
import { useLocation } from "@/lib/navigation";
import { useQuery } from "@tanstack/react-query";
import { pendingFriendRequestsQuery, pendingTabInviteRequestsQuery } from "@/lib/queries";

function setBadge(count: number): void {
  if (typeof navigator === "undefined") return;
  if (!("setAppBadge" in navigator)) return;
  try {
    if (count > 0) {
      (navigator as Navigator & { setAppBadge: (count: number) => Promise<void> })
        .setAppBadge(count);
    } else {
      (navigator as Navigator & { clearAppBadge: () => Promise<void> })
        .clearAppBadge();
    }
  } catch {
    // Badging API not supported or failed
  }
}

export function useAppBadge(enabled: boolean): void {
  const { pathname } = useLocation();

  const { data: friendRequestsData } = useQuery({
    ...pendingFriendRequestsQuery(),
    enabled,
  });

  const { data: tabInvitesData } = useQuery({
    ...pendingTabInviteRequestsQuery(),
    enabled,
  });

  const friendCount = friendRequestsData?.length ?? 0;
  const tabInviteCount = tabInvitesData?.length ?? 0;

  const isViewingFriends = pathname === "/friends" || pathname === "/friends/";
  const isViewingTabs = pathname === "/tabs" || pathname.startsWith("/tabs/");

  const unreadCount =
    (isViewingFriends ? 0 : friendCount) + (isViewingTabs ? 0 : tabInviteCount);

  useEffect(() => {
    if (!enabled) {
      setBadge(0);
      return;
    }
    setBadge(unreadCount);
  }, [enabled, unreadCount]);
}
