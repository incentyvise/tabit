import { format, formatDistanceToNowStrict } from "date-fns";

type DateLike = Date | string | number | null | undefined;

function toDate(value: DateLike): Date | null {
  if (value == null) return null;
  const d = value instanceof Date ? value : new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

export function fmtDate(value: DateLike): string {
  const d = toDate(value);
  return d ? format(d, "MMM d, yyyy") : "—";
}

export function fmtDateTime(value: DateLike): string {
  const d = toDate(value);
  return d ? format(d, "MMM d, yyyy HH:mm") : "—";
}

export function fmtAgo(value: DateLike): string {
  const d = toDate(value);
  return d ? `${formatDistanceToNowStrict(d)} ago` : "never";
}

export function fmtNumber(n: number | null | undefined): string {
  return n == null ? "—" : new Intl.NumberFormat().format(n);
}

export function fmtMoney(amount: number | string | null | undefined, currency?: string | null): string {
  if (amount == null) return "—";
  const n = typeof amount === "string" ? Number(amount) : amount;
  try {
    return new Intl.NumberFormat(undefined, {
      style: "currency",
      currency: currency ?? "USD",
      maximumFractionDigits: 2,
    }).format(n);
  } catch {
    return `${n.toFixed(2)} ${currency ?? ""}`.trim();
  }
}

export function fmtPercent(part: number, whole: number): string {
  if (!whole) return "—";
  return `${Math.round((part / whole) * 100)}%`;
}

export function fmtDuration(seconds: number): string {
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (d) return `${d}d ${h}h`;
  if (h) return `${h}h ${m}m`;
  return `${m}m`;
}

export function displayName(u: { name?: string | null; username?: string | null; email?: string | null }): string {
  return u.name || (u.username ? `@${u.username}` : "") || u.email || "Unknown";
}

/** Short browser/OS label from a user agent string. */
export function describeUserAgent(ua: string | null | undefined): string {
  if (!ua) return "Unknown device";
  const os = /iPhone|iPad/.test(ua)
    ? "iOS"
    : /Android/.test(ua)
      ? "Android"
      : /Mac OS X/.test(ua)
        ? "macOS"
        : /Windows/.test(ua)
          ? "Windows"
          : /Linux/.test(ua)
            ? "Linux"
            : "Other";
  const browser = /Edg\//.test(ua)
    ? "Edge"
    : /Firefox\//.test(ua)
      ? "Firefox"
      : /Chrome\//.test(ua)
        ? "Chrome"
        : /Safari\//.test(ua)
          ? "Safari"
          : "Browser";
  return `${browser} · ${os}`;
}
