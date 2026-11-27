import { z } from "zod";
import { expenseService } from "services";
import { unwrap } from "../context.js";
import { defineTool, type ToolContext } from "../tool.js";
import { displayUser, isoDate, roundMoney } from "../format.js";
import { nameIndex, normalize } from "../resolve.js";
import {
  categoryKey,
  expenseFilterShape,
  fetchExpenses,
  queryOptions,
  similarAmounts,
  similarDescriptions,
  tabRef,
  tabsToScan,
  type TabExpense,
} from "../expense-query.js";
import { balancesFor } from "./read.js";

const GROUP_BY = ["month", "payer", "category", "description", "person", "tab"] as const;
type GroupBy = (typeof GROUP_BY)[number];

type Bucket = {
  key: string;
  label: string;
  currency: string;
  total: number;
  count: number;
  yourShare: number;
  youPaid: number;
};

const MAX_GROUPS = 100;
const DAY_MS = 24 * 60 * 60 * 1000;

function bump(map: Map<string, Bucket>, key: string, label: string, currency: string, add: Omit<Bucket, "key" | "label" | "currency">) {
  const id = `${currency}\u0000${key}`;
  const b = map.get(id) ?? { key, label, currency, total: 0, count: 0, yourShare: 0, youPaid: 0 };
  b.total += add.total;
  b.count += add.count;
  b.yourShare += add.yourShare;
  b.youPaid += add.youPaid;
  map.set(id, b);
}

function roundBucket(b: Bucket) {
  return {
    ...(b.key !== b.label ? { key: b.key } : {}),
    group: b.label,
    currency: b.currency,
    total: roundMoney(b.total, b.currency),
    count: b.count,
    yourShare: roundMoney(b.yourShare, b.currency),
    youPaid: roundMoney(b.youPaid, b.currency),
  };
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export const insightTools = [
  defineTool({
    name: "summarize_expenses",
    title: "Expense totals",
    description:
      "Adds up expenses on the server and returns totals, counts, your share and what you paid, per group and overall. Use it for any 'how much' question instead of listing and adding expenses yourself. " +
      "Leave `tab` empty to cover every tab and friend. Takes the same filters as list_expenses (search, amount, from/to, paidBy, involving, filter). " +
      "groupBy: month, payer, category (first word of the description, so 'Blinkit', 'Blinkit 2.0' and 'Blinkit diwali' group together), description (exact text), person (each person's share of the cost), or tab. " +
      "Examples: Blinkit in November → {tab: \"Pauri\", search: \"blinkit\", from: \"2026-11\", to: \"2026-11\"}; my share of everything in November → {from: \"2026-11\", to: \"2026-11\"}; spend by month → {tab: \"Pauri\", groupBy: \"month\"}. " +
      "Totals are in each tab's currency; currencies are never mixed. Deleted expenses are left out.",
    scope: "read",
    input: z.object({
      tab: tabRef.optional().describe("Which tab (id, group name, or friend). Leave empty for all tabs."),
      ...expenseFilterShape,
      groupBy: z.enum(GROUP_BY).optional().describe("How to break the totals down. Omit for just the overall totals."),
    }),
    async handler(args, ctx) {
      const tabs = await tabsToScan(args.tab, ctx);
      const groups = new Map<string, Bucket>();
      const grand = new Map<string, Bucket>();
      let tabsWithMatches = 0;

      for (const { tab: t, label: tabLabel } of tabs) {
        const opts = queryOptions(t, args, ctx, { acrossTabs: !args.tab });
        if (!opts) continue;
        const expenses = await fetchExpenses(t.id, opts, ctx);
        if (expenses.length === 0) continue;
        tabsWithMatches++;
        const names = nameIndex(t, ctx.userId);
        const myPid = t.participants.find((p) => p.userId === ctx.userId)?.id;
        const cur = t.currency;
        const personKey = (pid: string | null | undefined, uid: string | null | undefined) => {
          if ((pid && pid === myPid) || uid === ctx.userId) return { key: "you", label: "You" };
          const p = t.participants.find((x) => x.id === pid || (uid && x.userId === uid));
          const key = p?.userId && p.kind !== "placeholder" ? `user:${p.userId}` : `participant:${p?.id ?? pid ?? uid}`;
          return { key, label: names.get(pid ?? "") ?? names.get(uid ?? "") ?? "Unknown" };
        };

        for (const e of expenses) {
          const total = Number(e.amount);
          const paidByMe = e.paidByParticipantId ? e.paidByParticipantId === myPid : e.paidById === ctx.userId;
          const yourShare = e.splits
            .filter((s) => s.userId === ctx.userId || (myPid && s.participantId === myPid))
            .reduce((a, s) => a + Number(s.amount), 0);
          const add = { total, count: 1, yourShare, youPaid: paidByMe ? total : 0 };
          bump(grand, cur, cur, cur, add);

          switch (args.groupBy as GroupBy | undefined) {
            case "month": {
              const m = isoDate(e.expenseDate, ctx.timeZone)?.slice(0, 7) ?? "unknown";
              bump(groups, m, m, cur, add);
              break;
            }
            case "payer": {
              const p = personKey(e.paidByParticipantId, e.paidById);
              bump(groups, p.key, p.label, cur, add);
              break;
            }
            case "category": {
              const k = categoryKey(e.description);
              bump(groups, k, capitalize(k), cur, add);
              break;
            }
            case "description": {
              const k = normalize(e.description);
              // The first description seen becomes the group's label.
              bump(groups, k, e.description.trim(), cur, add);
              break;
            }
            case "person": {
              for (const s of e.splits) {
                const p = personKey(s.participantId, s.userId);
                const share = Number(s.amount);
                bump(groups, p.key, p.label, cur, {
                  total: share,
                  count: 1,
                  yourShare: p.key === "you" ? share : 0,
                  youPaid: 0,
                });
              }
              break;
            }
            case "tab":
              bump(groups, t.id, tabLabel, cur, add);
              break;
          }
        }
      }

      const totals = [...grand.values()].map((b) => {
        const { group: _g, key: _k, ...rest } = roundBucket(b);
        return rest;
      });
      let grouped = [...groups.values()];
      grouped.sort((a, b) =>
        args.groupBy === "month"
          ? a.key.localeCompare(b.key) || a.currency.localeCompare(b.currency)
          : b.total - a.total,
      );
      const truncated = grouped.length > MAX_GROUPS;
      grouped = grouped.slice(0, MAX_GROUPS);

      const where = args.tab ? `"${tabs[0]?.label}"` : `${tabsWithMatches} tab${tabsWithMatches === 1 ? "" : "s"}`;
      const summary =
        totals.length === 0
          ? "No expenses match."
          : `${totals
              .map((t) => `${t.count} expense${t.count === 1 ? "" : "s"} in ${where}, total ${t.total} ${t.currency}, your share ${t.yourShare} ${t.currency}, you paid ${t.youPaid} ${t.currency}`)
              .join("; ")}.`;
      return {
        summary,
        data: {
          totals,
          ...(args.groupBy
            ? {
                groupBy: args.groupBy,
                groups: grouped.map((b) => {
                  const r = roundBucket(b);
                  return args.groupBy === "person" ? { group: r.group, currency: r.currency, share: r.total, count: r.count } : r;
                }),
                ...(truncated ? { truncated: true, note: `Only the top ${MAX_GROUPS} groups are shown; narrow the filters for the rest.` } : {}),
              }
            : {}),
        },
      };
    },
  }),

  defineTool({
    name: "find_possible_duplicates",
    title: "Find possible duplicates",
    description:
      "Scans a tab for expenses that look like the same thing logged twice: similar amount (within 1%) and similar description, dated within `withinDays` of each other. " +
      "Narrow it with from/to (and the other list_expenses filters). Show the pairs to the user; never delete one without asking. " +
      "Example: {tab: \"Pauri\", from: \"2026-11\", to: \"2026-11\"}.",
    scope: "read",
    input: z.object({
      tab: tabRef,
      ...expenseFilterShape,
      withinDays: z.number().int().min(0).max(31).optional().describe("Max days apart (default 3)."),
    }),
    async handler(args, ctx) {
      const target = await ctx.dir.resolveTarget(args.tab);
      const t = await ctx.dir.requireTab(target.tabId);
      const names = nameIndex(t, ctx.userId);
      const expenses = await fetchExpenses(t.id, queryOptions(t, args, ctx)!, ctx);
      const sorted = [...expenses].sort(
        (a, b) => new Date(a.expenseDate).getTime() - new Date(b.expenseDate).getTime(),
      );
      const windowMs = (args.withinDays ?? 3) * DAY_MS + DAY_MS / 2;
      const brief = (e: TabExpense) => ({
        expenseId: e.id,
        description: e.description,
        date: isoDate(e.expenseDate, ctx.timeZone),
        amount: roundMoney(Number(e.amount), t.currency),
        paidBy: names.get(e.paidByParticipantId ?? e.paidById) ?? "Unknown",
      });
      const pairs: Array<{ a: ReturnType<typeof brief>; b: ReturnType<typeof brief> }> = [];
      outer: for (let i = 0; i < sorted.length; i++) {
        const a = sorted[i]!;
        const ta = new Date(a.expenseDate).getTime();
        for (let j = i + 1; j < sorted.length; j++) {
          const b = sorted[j]!;
          if (new Date(b.expenseDate).getTime() - ta > windowMs) break;
          if (similarAmounts(Number(a.amount), Number(b.amount)) && similarDescriptions(a.description, b.description)) {
            pairs.push({ a: brief(a), b: brief(b) });
            if (pairs.length >= 50) break outer;
          }
        }
      }
      return {
        summary:
          pairs.length === 0
            ? `No likely duplicates among ${expenses.length} expenses.`
            : `${pairs.length} possible duplicate pair${pairs.length === 1 ? "" : "s"} among ${expenses.length} expenses.${pairs.length >= 50 ? " Showing the first 50; narrow the dates for more." : ""}`,
        data: { tabId: t.id, currency: t.currency, pairs },
      };
    },
  }),

  defineTool({
    name: "get_settle_up",
    title: "Settle-up plan",
    description:
      "Who should pay whom, and how much, to settle up, using simplified debts (the fewest payments). With `tab`, returns the full plan for that tab; without it, returns every payment you need to make or receive across all tabs and friends. " +
      "To record a payment afterwards, use record_settlement.",
    scope: "read",
    input: z.object({
      tab: tabRef.optional().describe("Which tab. Leave empty for everything involving you."),
    }),
    async handler(args, ctx) {
      const tabIds: Array<{ id: string; label: string }> = [];
      if (args.tab) {
        const target = await ctx.dir.resolveTarget(args.tab);
        tabIds.push({ id: target.tabId, label: target.kind === "friend" ? `You & ${target.name}` : target.name });
      } else {
        const [groups, friends] = await Promise.all([ctx.dir.groupTabs(), ctx.dir.friendTabs()]);
        for (const g of groups) if (Math.abs(g.balance ?? 0) >= 0.005) tabIds.push({ id: g.id, label: g.name });
        for (const f of friends) {
          if (Math.abs(f.balance) >= 0.005) tabIds.push({ id: f.id, label: `You & ${displayUser(f.friend)}` });
        }
      }
      const plans = await Promise.all(
        tabIds.map(async ({ id, label }) => {
          const { tab: t, suggestedTransfers } = await balancesFor(id, ctx);
          const transfers = suggestedTransfers
            .map((tr) => ({ ...tr, involvesYou: tr.from === "You" || tr.to === "You" }))
            .filter((tr) => args.tab || tr.involvesYou);
          return { tabId: t.id, tab: label, currency: t.currency, transfers };
        }),
      );
      const withTransfers = plans.filter((p) => p.transfers.length > 0);
      const lines = withTransfers.flatMap((p) =>
        p.transfers
          .filter((tr) => tr.involvesYou)
          .map((tr) => (tr.from === "You" ? `you pay ${tr.to} ${tr.amount} ${tr.currency}` : `${tr.from} pays you ${tr.amount} ${tr.currency}`) + ` (${p.tab})`),
      );
      return {
        summary:
          withTransfers.length === 0
            ? "Everyone is settled up."
            : lines.length > 0
              ? `To settle up: ${lines.join("; ")}.`
              : "You're settled up; other people in this tab still owe each other.",
        data: withTransfers,
      };
    },
  }),

  defineTool({
    name: "get_expense_history",
    title: "Expense edit history",
    description:
      "Who created, changed, deleted or restored an expense and when, with the old and new values of each change and whether it was made via an MCP client.",
    scope: "read",
    input: z.object({ tab: tabRef, expenseId: z.string().min(1) }),
    async handler(args, ctx: ToolContext) {
      const target = await ctx.dir.resolveTarget(args.tab);
      const rows = unwrap(await expenseService.getAuditLog(target.tabId, args.expenseId, ctx.userId));
      const history = rows.map((h) => ({
        action: h.action,
        by: h.performedById === ctx.userId ? "You" : displayUser(h.performedBy),
        at: h.performedAt,
        via: h.viaMcpClient ?? null,
        changes: h.changes,
      }));
      return {
        summary: `${history.length} change${history.length === 1 ? "" : "s"} to this expense.`,
        data: { expenseId: args.expenseId, tabId: target.tabId, history },
      };
    },
  }),
];
