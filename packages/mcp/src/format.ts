import { getCurrency } from "shared";

/** Round to the currency's minor unit (e.g. 2 dp for USD, 0 for JPY). */
export function roundMoney(amount: number, currency: string): number {
  const digits = getCurrency(currency)?.decimal_digits ?? 2;
  const scale = Math.pow(10, digits);
  return Math.round(amount * scale) / scale;
}

export function money(amount: number, currency: string): { amount: number; currency: string } {
  return { amount: roundMoney(amount, currency), currency };
}

/** Calendar date (YYYY-MM-DD) in the user's timezone. */
export function isoDate(d: Date | string | null | undefined, timeZone?: string | null): string | null {
  if (!d) return null;
  const date = typeof d === "string" ? new Date(d) : d;
  if (Number.isNaN(date.getTime())) return null;
  try {
    return new Intl.DateTimeFormat("en-CA", {
      timeZone: timeZone || "UTC",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(date);
  } catch {
    return date.toISOString().slice(0, 10);
  }
}

/** Today's date (YYYY-MM-DD) in the user's timezone. */
export function todayIso(timeZone?: string | null): string {
  return isoDate(new Date(), timeZone)!;
}

/**
 * Parses a YYYY-MM-DD (or full ISO) date from a tool argument. Bare dates are
 * pinned to midday UTC so they land on the same calendar day in any timezone.
 */
export function parseDateArg(value: string | undefined, field: string): Date | undefined {
  if (value === undefined) return undefined;
  const v = value.trim();
  const d = /^\d{4}-\d{2}-\d{2}$/.test(v) ? new Date(`${v}T12:00:00Z`) : new Date(v);
  if (Number.isNaN(d.getTime())) {
    throw new Error(`${field} must be a date like 2026-11-26`);
  }
  return d;
}

export function displayUser(u: {
  name?: string | null;
  username?: string | null;
} | null | undefined): string {
  if (!u) return "Unknown";
  return u.name?.trim() || (u.username ? `@${u.username}` : "Unknown");
}

/** Signed balance in words, from the user's point of view. */
export function describeNet(amount: number, currency: string): string {
  const v = roundMoney(amount, currency);
  if (v > 0) return `owed ${v} ${currency}`;
  if (v < 0) return `owes ${Math.abs(v)} ${currency}`;
  return "settled up";
}
