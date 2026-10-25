import { createElement, useCallback, useMemo, type ComponentProps } from "react";
import {
  Link as TanStackLink,
  useNavigate as useTanStackNavigate,
  useParams as useTanStackParams,
  useLocation,
  useRouter,
  type NavigateOptions,
} from "@tanstack/react-router";

export { useLocation, useRouter };

type NavigateTo = Parameters<ReturnType<typeof useTanStackNavigate>>[0];

/**
 * An in-app path ("/tabs?x=1"), or `fallback` for anything else: absolute
 * URLs, protocol-relative "//host", backslash tricks, or missing values.
 * Use for every redirect target that comes from the URL (callbackURL, returnTo).
 */
export function safeInternalPath(
  value: string | null | undefined,
  fallback: string,
): string {
  if (!value || !value.startsWith("/") || /^\/[\\/]/.test(value)) {
    return fallback;
  }
  try {
    const url = new URL(value, "https://app.invalid");
    if (url.origin !== "https://app.invalid") return fallback;
    return url.pathname + url.search + url.hash;
  } catch {
    return fallback;
  }
}

/** Stable across renders (safe in effect dependency arrays). */
export function useNavigate() {
  const navigate = useTanStackNavigate();
  const router = useRouter();
  return useCallback(
    (
      to: string | number | NavigateTo,
      options?: { replace?: boolean; state?: unknown },
    ) => {
      if (typeof to === "number") {
        router.history.go(to);
        return;
      }
      if (typeof to === "string") {
        // `to` is a path only; a query/hash (e.g. a returnTo URL) needs `href`.
        // Only same-origin paths go through `href`, which would otherwise
        // follow an absolute URL off-site.
        if (/[?#]/.test(to)) {
          return router.navigate({
            href: safeInternalPath(to, "/tabs"),
            replace: options?.replace,
            state: options?.state,
          } as NavigateOptions);
        }
        return navigate({
          to,
          replace: options?.replace,
          state: options?.state,
        } as NavigateOptions);
      }
      return navigate(to);
    },
    [navigate, router],
  );
}

/**
 * Back that never dead-ends: when the app was opened directly on this page
 * (deep link, push notification) there is no in-app history entry, so fall
 * back to the page's logical parent.
 */
export function useGoBack() {
  const router = useRouter();
  const navigate = useNavigate();
  return useCallback(
    (fallbackHref: string) => {
      if (router.history.canGoBack()) router.history.back();
      else void navigate(fallbackHref, { replace: true });
    },
    [router, navigate],
  );
}

export function useParams<
  T extends Record<string, string | undefined> = Record<string, string>,
>(): T {
  return useTanStackParams({ strict: false } as never) as T;
}

type AppLinkProps = Omit<ComponentProps<typeof TanStackLink>, "to"> & {
  to: string;
};

export function Link(props: AppLinkProps) {
  return createElement(TanStackLink, {
    ...(props as ComponentProps<typeof TanStackLink>),
    to: props.to as ComponentProps<typeof TanStackLink>["to"],
  });
}

export function useSearchParams(): [
  URLSearchParams,
  (
    next:
      | URLSearchParams
      | Record<string, string>
      | ((prev: URLSearchParams) => URLSearchParams),
    options?: { replace?: boolean },
  ) => void,
] {
  const location = useLocation();
  const navigate = useNavigate();
  const searchStr = location.searchStr ?? "";
  // Same identity while the query string is unchanged (safe in effect deps).
  const searchParams = useMemo(() => new URLSearchParams(searchStr), [searchStr]);

  const setSearchParams = (
    next:
      | URLSearchParams
      | Record<string, string>
      | ((prev: URLSearchParams) => URLSearchParams),
    options?: { replace?: boolean },
  ) => {
    const prev = new URLSearchParams(location.searchStr ?? "");
    const resolved =
      typeof next === "function"
        ? next(prev)
        : next instanceof URLSearchParams
          ? next
          : new URLSearchParams(next);
    const qs = resolved.toString();
    // Go through the router (raw pushState would drop its history index/key,
    // breaking canGoBack and scroll restoration).
    void navigate(location.pathname + (qs ? `?${qs}` : "") + (location.hash ? `#${location.hash}` : ""), {
      replace: options?.replace,
    });
  };

  return [searchParams, setSearchParams];
}
