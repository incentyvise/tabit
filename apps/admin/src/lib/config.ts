function trimSlash(url: string): string {
  return url.replace(/\/$/, "");
}

/** API origin (oRPC + Better Auth). Empty in dev → same-origin via the Vite proxy. */
export const apiBaseUrl = trimSlash(import.meta.env.VITE_API_URL ?? "");

export const pwaUrl = trimSlash(import.meta.env.NEXT_PUBLIC_PWA_URL ?? "https://app.tabit.in");
