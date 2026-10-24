import type { ReactNode } from "react";
import { create } from "zustand";

export type NavTitleConfig = {
  title: string;
  backHref: string;
  avatarUserIds?: string[];
  avatarDisplayName?: string;
  icon?: ReactNode;
};

/**
 * Known nav configs keyed by pathname.
 * `null` = logo navbar (list pages). `undefined` = page sets title via setNavPage.
 */
function getDefaultNavConfig(pathname: string): NavTitleConfig | null | undefined {
  if (pathname === "/me") return { title: "Profile", backHref: "/tabs" };
  if (pathname === "/expense/new")
    return { title: "Log Expense", backHref: "/tabs" };
  if (pathname === "/tabs/new") return { title: "New tab", backHref: "/tabs" };
  if (pathname === "/friends" || pathname === "/friends/") return null;
  if (pathname === "/tabs" || pathname === "/tabs/") return null;
  if (pathname === "/activity") return null;
  if (pathname === "/onboarding") return null;
  return undefined;
}

function getParentPath(pathname: string): string {
  const tabDetail = pathname.match(/^\/tabs\/[^/]+(?=\/.)/);
  if (tabDetail) return tabDetail[0];
  return "/tabs";
}

interface NavState {
  displayPathname: string;
  navPage: NavTitleConfig | null;
  setDisplayPathname: (pathname: string) => void;
  setNavPage: (config: NavTitleConfig | null) => void;
}

export const useNavStore = create<NavState>((set) => ({
  displayPathname: "",
  navPage: null,
  setDisplayPathname: (pathname) =>
    set((state) => {
      const known = getDefaultNavConfig(pathname);
      if (known !== undefined) {
        return { displayPathname: pathname, navPage: known };
      }
      // Dynamic route: drop the previous page's title but show a back button
      // right away; the page fills in its title once its data loads.
      return {
        displayPathname: pathname,
        navPage:
          state.displayPathname !== pathname
            ? { title: "", backHref: getParentPath(pathname) }
            : state.navPage,
      };
    }),
  setNavPage: (config) => set({ navPage: config }),
}));
