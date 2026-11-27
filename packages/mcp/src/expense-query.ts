import { z } from "zod";
import type { ExpensePersonRef, GetExpensesForTabOptions, TabWithMembers } from "data";
import { expenseService } from "services";
import { ToolError, unwrap } from "./context.js";
import { normalize, resolveParticipant } from "./resolve.js";
import type { ToolContext } from "./tool.js";

export const tabRef = z
  .string()
  .min(1)
  .describe(
    "Which tab: a tab id, a group tab's name, or a friend's username/name for your 1:1 tab with them.",
  );

const personFilterRef = z
  .string()
  .min(1)
  .describe('A person: "me", a username, a name, or a participantId from get_tab.');

/** Filters shared by list_expenses, summarize_expenses and find_possible_duplicates. */
export const expenseFilterShape = {
  filter: z
    .enum(["all", "involved", "owed", "owe"])
    .optional()
    .describe("all (default), involved (you paid or share), owed (you paid, others owe you), owe (someone else paid and you share)."),
  search: z
    .string()
    .max(200)
    .optional()
    .describe('Text to find in descriptions (case-insensitive substring), e.g. "blinkit".'),
  amount: z
    .number()
    .positive()
    .optional()
    .describe("Exact amount: matches the tab-currency total or the amount as entered, e.g. 1967."),
  minAmount: z.number().nonnegative().optional().describe("Tab-currency total at least this."),
  maxAmount: z.number().nonnegative().optional().describe("Tab-currency total at most this."),
  from: z
    .string()
    .optional()
    .describe("Start date, inclusive, in your timezone: YYYY-MM-DD, or YYYY-MM for the start of that month."),
  to: z
    .string()
    .optional()
    .describe("End date, inclusive, in your timezone: YYYY-MM-DD, or YYYY-MM for the end of that month."),
  paidBy: personFilterRef.optional().describe('Only expenses this person paid: "me", a username, a name or a participantId.'),
  involving: personFilterRef
    .optional()
    .describe("Only expenses this person paid or is part of the split of."),
};

const filterObject = z.object(expenseFilterShape);
export type ExpenseFilterArgs = z.infer<typeof filterObject>;

/** Offset (ms) of `timeZone` from UTC at instant `t`. */
function tzOffsetMs(t: number, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(new Date(t));
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? 0);
  const asUtc = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"), get("second"));
  return asUtc - Math.floor(t / 1000) * 1000;
}

/** The instant local midnight of y-m-d starts in `timeZone`. */
export function startOfLocalDay(y: number, m: number, d: number, timeZone: string | null): Date {
  const guess = Date.UTC(y, m - 1, d);
  const tz = timeZone || "UTC";
  try {
    let t = guess - tzOffsetMs(guess, tz);
    t = guess - tzOffsetMs(t, tz);
    return new Date(t);
  } catch {
    return new Date(guess);
  }
}

/**
 * Turns `from`/`to` arguments into a half-open [from, to) range of instants.
 * Accepts YYYY-MM-DD or YYYY-MM; `to` is inclusive of the whole day/month.
 */
export function dateRange(
  from: string | undefined,
  to: string | undefined,
  timeZone: string | null,
): { from?: Date; to?: Date } {
  const parse = (value: string, field: string, end: boolean): Date => {
    const v = value.trim();
    const day = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v);
    if (day) {
      const [y, m, d] = [Number(day[1]), Number(day[2]), Number(day[3])];
      return end ? startOfLocalDay(y, m, d + 1, timeZone) : startOfLocalDay(y, m, d, timeZone);
    }
    const month = /^(\d{4})-(\d{2})$/.exec(v);
    if (month) {
      const [y, m] = [Number(month[1]), Number(month[2])];
      return end ? startOfLocalDay(y, m + 1, 1, timeZone) : startOfLocalDay(y, m, 1, timeZone);
    }
    throw new ToolError(`${field} must be a date like 2026-11-26 or a month like 2026-11`);
  };
  const out = {
    ...(from ? { from: parse(from, "from", false) } : {}),
    ...(to ? { to: parse(to, "to", true) } : {}),
  };
  if (out.from && out.to && out.from >= out.to) {
    throw new ToolError("`from` must be on or before `to`.");
  }
  return out;
}

function personRef(t: TabWithMembers, ref: string, userId: string): ExpensePersonRef {
  const p = resolveParticipant(t, ref, userId);
  return { participantId: p.id, userId: p.kind === "placeholder" ? null : p.userId };
}

/**
 * Builds data-layer query options for one tab. Returns null when a person
 * filter names someone who isn't in this tab (only possible when the same
 * filters are applied across every tab).
 */
export function queryOptions(
  t: TabWithMembers,
  args: ExpenseFilterArgs,
  ctx: ToolContext,
  opts: { acrossTabs?: boolean } = {},
): GetExpensesForTabOptions | null {
  if (args.minAmount !== undefined && args.maxAmount !== undefined && args.minAmount > args.maxAmount) {
    throw new ToolError("minAmount must not be more than maxAmount.");
  }
  const resolvePerson = (ref: string | undefined): ExpensePersonRef | undefined | null => {
    if (!ref) return undefined;
    try {
      return personRef(t, ref, ctx.userId);
    } catch (e) {
      // Across tabs, a person missing from this tab just means it has no matches.
      if (opts.acrossTabs && e instanceof ToolError && /^No person/.test(e.message)) return null;
      throw e;
    }
  };
  const paidBy = resolvePerson(args.paidBy);
  const involving = resolvePerson(args.involving);
  if (paidBy === null || involving === null) return null;
  return {
    ...(args.filter && args.filter !== "all" ? { filter: args.filter, userId: ctx.userId } : {}),
    ...(args.search?.trim() ? { search: args.search.trim() } : {}),
    ...(args.amount !== undefined ? { amount: args.amount } : {}),
    ...(args.minAmount !== undefined ? { minAmount: args.minAmount } : {}),
    ...(args.maxAmount !== undefined ? { maxAmount: args.maxAmount } : {}),
    ...dateRange(args.from, args.to, ctx.timeZone),
    ...(paidBy ? { paidBy } : {}),
    ...(involving ? { involving } : {}),
  };
}

export type TabExpense = Awaited<ReturnType<typeof fetchExpenses>>[number];

/** Every non-deleted expense in a tab matching `options` (no paging). */
export async function fetchExpenses(
  tabId: string,
  options: GetExpensesForTabOptions,
  ctx: ToolContext,
) {
  const result = unwrap(
    await expenseService.getForTab(tabId, ctx.userId, { ...options, excludeDeleted: true }),
  );
  return result.expenses;
}

/** Tabs to scan: one when `tab` is given, otherwise every group and friend tab. */
export async function tabsToScan(
  ref: string | undefined,
  ctx: ToolContext,
): Promise<Array<{ tab: TabWithMembers; label: string; isFriend: boolean }>> {
  if (ref) {
    const target = await ctx.dir.resolveTarget(ref);
    const t = await ctx.dir.requireTab(target.tabId);
    return [{ tab: t, label: target.kind === "friend" ? `You & ${target.name}` : t.name, isFriend: target.kind === "friend" }];
  }
  const [groups, friends] = await Promise.all([ctx.dir.groupTabs(), ctx.dir.friendTabs()]);
  const refs = [
    ...groups.map((g) => ({ id: g.id, label: g.name, isFriend: false })),
    ...friends.map((f) => ({
      id: f.id,
      label: `You & ${f.friend.name?.trim() || (f.friend.username ? `@${f.friend.username}` : "friend")}`,
      isFriend: true,
    })),
  ];
  const out: Array<{ tab: TabWithMembers; label: string; isFriend: boolean }> = [];
  for (let i = 0; i < refs.length; i += 8) {
    const chunk = await Promise.all(refs.slice(i, i + 8).map((r) => ctx.dir.tabDetail(r.id)));
    chunk.forEach((t, j) => {
      if (t && t.members.some((m) => m.userId === ctx.userId)) {
        out.push({ tab: t, label: refs[i + j]!.label, isFriend: refs[i + j]!.isFriend });
      }
    });
  }
  return out;
}

const STOP_WORDS = new Set(["the", "a", "an", "for", "at", "to", "of", "and", "on", "in", "my", "our"]);

/**
 * A rough category for free-text descriptions: the first meaningful word,
 * so "Blinkit", "Blinkit 2.0" and "Blinkit diwali" all land in "blinkit".
 */
export function categoryKey(description: string): string {
  const words = normalize(description)
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .split(/\s+/)
    .filter((w) => w && !STOP_WORDS.has(w) && !/^\d+$/.test(w));
  return words[0] ?? "other";
}

function tokens(description: string): Set<string> {
  return new Set(
    normalize(description)
      .replace(/[^\p{L}\p{N}\s]/gu, " ")
      .split(/\s+/)
      .filter((w) => w && !STOP_WORDS.has(w)),
  );
}

/** True when two descriptions look like the same thing. */
export function similarDescriptions(a: string, b: string): boolean {
  const na = normalize(a);
  const nb = normalize(b);
  if (na === nb || na.includes(nb) || nb.includes(na)) return true;
  if (categoryKey(a) === categoryKey(b)) return true;
  const ta = tokens(a);
  const tb = tokens(b);
  if (ta.size === 0 || tb.size === 0) return false;
  let shared = 0;
  for (const w of ta) if (tb.has(w)) shared++;
  return shared / Math.min(ta.size, tb.size) >= 0.5;
}

/** Amounts within 1% (and at least 1 unit) of each other. */
export function similarAmounts(a: number, b: number): boolean {
  return Math.abs(a - b) <= Math.max(1, Math.max(Math.abs(a), Math.abs(b)) * 0.01);
}

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Existing expenses in a tab that look like the one about to be added:
 * similar amount, similar description (or same day), within `withinDays`.
 */
export async function possibleDuplicatesOf(
  tabId: string,
  candidate: { amount: number; currency: string; description: string; date: Date },
  tabCurrency: string,
  ctx: ToolContext,
  withinDays = 3,
) {
  const expenses = await fetchExpenses(
    tabId,
    {
      from: new Date(candidate.date.getTime() - withinDays * DAY_MS),
      to: new Date(candidate.date.getTime() + withinDays * DAY_MS + 1),
    },
    ctx,
  );
  const sameDay = (d: Date) => Math.abs(d.getTime() - candidate.date.getTime()) < DAY_MS;
  return expenses.filter((e) => {
    const entered = candidate.currency === tabCurrency ? Number(e.amount) : Number(e.originalAmount);
    const comparable = candidate.currency === tabCurrency || e.currency === candidate.currency;
    if (!comparable || !similarAmounts(entered, candidate.amount)) return false;
    return similarDescriptions(e.description, candidate.description) || sameDay(new Date(e.expenseDate));
  });
}
