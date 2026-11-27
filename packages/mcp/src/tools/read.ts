import { z } from "zod";
import { activity, user as userData } from "data";
import {
  expenseService,
  friendService,
  recurringExpenseService,
  tabInviteService,
  tabService,
  convertToTabCurrency,
} from "services";
import { CURRENCY_CODES, simplifyDebts } from "shared";
import { ToolError, unwrap } from "../context.js";
import { defineTool, type ToolContext } from "../tool.js";
import { describeNet, displayUser, isoDate, money, parseDateArg, roundMoney } from "../format.js";
import { nameIndex, normalize, participantSummary } from "../resolve.js";
import { expenseFilterShape, queryOptions, tabRef } from "../expense-query.js";

/** Balances plus suggested settle-up transfers for one tab, named from the user's point of view. */
async function balancesFor(tabId: string, ctx: ToolContext) {
  const t = await ctx.dir.requireTab(tabId);
  const balances = unwrap(await tabService.getBalancesForTab(tabId, ctx.userId));
  const names = nameIndex(t, ctx.userId);
  const { transfers } = simplifyDebts(
    balances.map((b) => ({ participantId: b.participantId, amount: b.amount })),
    { currency: t.currency },
  );
  return {
    tab: t,
    balances: balances.map((b) => ({
      participantId: b.participantId,
      name: names.get(b.participantId) ?? b.displayName,
      net: roundMoney(b.amount, t.currency),
      status: describeNet(b.amount, t.currency),
    })),
    suggestedTransfers: transfers.map((tr) => ({
      from: names.get(tr.fromParticipantId) ?? tr.fromParticipantId,
      fromParticipantId: tr.fromParticipantId,
      to: names.get(tr.toParticipantId) ?? tr.toParticipantId,
      toParticipantId: tr.toParticipantId,
      ...money(tr.amount, t.currency),
    })),
  };
}

export { balancesFor };

export const readTools = [
  defineTool({
    name: "get_me",
    title: "Who am I",
    description:
      "Returns the signed-in Tab user's profile: name, username, default currency and timezone. Use it to know who 'me' is and which currency to assume.",
    scope: "read",
    input: z.object({}),
    async handler(_args, ctx) {
      const me = await userData.getById(ctx.userId);
      if (!me) throw new ToolError("Account not found");
      return {
        summary: `Signed in as ${me.name?.trim() || (me.username ? `@${me.username}` : me.email)}.`,
        data: {
          userId: me.id,
          name: me.name || null,
          email: me.email,
          username: me.username,
          defaultCurrency: me.defaultCurrency ?? null,
          timezone: me.timezone ?? null,
          today: isoDate(new Date(), me.timezone),
        },
      };
    },
  }),

  defineTool({
    name: "get_overview",
    title: "Balances overview",
    description:
      "Big picture of where the user stands: total owed to them and total they owe (per currency), and every friend and group tab with a non-zero balance. Positive amounts mean the user is owed; negative means they owe. Start here for questions like 'who owes me money?' or 'how much do I owe in total?'.",
    scope: "read",
    input: z.object({}),
    async handler(_args, ctx) {
      const [groups, friends] = await Promise.all([ctx.dir.groupTabs(), ctx.dir.friendTabs()]);
      const totals = new Map<string, { owedToYou: number; youOwe: number }>();
      const add = (currency: string, amount: number) => {
        const t = totals.get(currency) ?? { owedToYou: 0, youOwe: 0 };
        if (amount > 0) t.owedToYou += amount;
        else t.youOwe += -amount;
        totals.set(currency, t);
      };
      const friendRows = friends
        .filter((f) => Math.abs(f.balance) >= 0.005)
        .map((f) => {
          add(f.currency, f.balance);
          return {
            friend: displayUser(f.friend),
            username: f.friend.username,
            tabId: f.id,
            net: roundMoney(f.balance, f.currency),
            currency: f.currency,
            status: describeNet(f.balance, f.currency),
          };
        })
        .sort((a, b) => Math.abs(b.net) - Math.abs(a.net));
      const groupRows = groups
        .filter((g) => Math.abs(g.balance ?? 0) >= 0.005)
        .map((g) => {
          add(g.currency, g.balance ?? 0);
          return {
            tab: g.name,
            tabId: g.id,
            net: roundMoney(g.balance ?? 0, g.currency),
            currency: g.currency,
            status: describeNet(g.balance ?? 0, g.currency),
          };
        })
        .sort((a, b) => Math.abs(b.net) - Math.abs(a.net));
      const totalsOut = [...totals.entries()].map(([currency, t]) => ({
        currency,
        owedToYou: roundMoney(t.owedToYou, currency),
        youOwe: roundMoney(t.youOwe, currency),
        net: roundMoney(t.owedToYou - t.youOwe, currency),
      }));
      const summary =
        totalsOut.length === 0
          ? "You're all settled up everywhere."
          : totalsOut
              .map((t) => `${t.currency}: owed to you ${t.owedToYou}, you owe ${t.youOwe}`)
              .join("; ");
      return {
        summary,
        data: {
          totals: totalsOut,
          friends: friendRows,
          groupTabs: groupRows,
          friendCount: friends.length,
          groupTabCount: groups.length,
        },
      };
    },
  }),

  defineTool({
    name: "list_tabs",
    title: "List group tabs",
    description:
      "Lists the user's group tabs (trips, households, events) with currency, the user's net balance, expense count and last activity. 1:1 balances with friends are in list_friends.",
    scope: "read",
    input: z.object({
      query: z.string().optional().describe("Only tabs whose name contains this text."),
      includeSettled: z
        .boolean()
        .optional()
        .describe("Include tabs where everyone is settled up (default true)."),
    }),
    async handler(args, ctx) {
      let tabs = await ctx.dir.groupTabs();
      if (args.query) {
        const q = normalize(args.query);
        tabs = tabs.filter((t) => normalize(t.name).includes(q));
      }
      if (args.includeSettled === false) tabs = tabs.filter((t) => !t.isSettled);
      return {
        summary: `${tabs.length} group tab${tabs.length === 1 ? "" : "s"}.`,
        data: tabs.map((t) => ({
          tabId: t.id,
          name: t.name,
          currency: t.currency,
          yourNet: roundMoney(t.balance ?? 0, t.currency),
          status: describeNet(t.balance ?? 0, t.currency),
          everyoneSettled: t.isSettled ?? null,
          expenseCount: t.expenseCount ?? null,
          lastActivity: isoDate(t.lastExpenseDate, ctx.timeZone),
        })),
      };
    },
  }),

  defineTool({
    name: "list_friends",
    title: "List friends",
    description:
      "Lists the user's friends with the 1:1 balance between them (positive = the friend owes the user). Each friend has a tabId for their shared 1:1 tab, which other tools accept.",
    scope: "read",
    input: z.object({
      query: z.string().optional().describe("Only friends whose name or username contains this text."),
    }),
    async handler(args, ctx) {
      let friends = await ctx.dir.friendTabs();
      if (args.query) {
        const q = normalize(args.query);
        friends = friends.filter(
          (f) =>
            normalize(f.friend.name ?? "").includes(q) ||
            normalize(f.friend.username ?? "").includes(q),
        );
      }
      return {
        summary: `${friends.length} friend${friends.length === 1 ? "" : "s"}.`,
        data: friends.map((f) => ({
          tabId: f.id,
          name: displayUser(f.friend),
          username: f.friend.username,
          currency: f.currency,
          net: roundMoney(f.balance, f.currency),
          status: describeNet(f.balance, f.currency),
          expenseCount: f.expenseCount,
          lastActivity: isoDate(f.lastExpenseDate, ctx.timeZone),
        })),
      };
    },
  }),

  defineTool({
    name: "get_tab",
    title: "Tab details and balances",
    description:
      "Details for one tab: its people (members and placeholders, with participantIds), each person's net balance, and the suggested transfers that would settle everyone up. Use participantIds or names from here when creating expenses or settlements.",
    scope: "read",
    input: z.object({ tab: tabRef }),
    async handler(args, ctx) {
      const target = await ctx.dir.resolveTarget(args.tab);
      const { tab: t, balances, suggestedTransfers } = await balancesFor(target.tabId, ctx);
      return {
        summary: `${target.kind === "friend" ? `1:1 tab with ${target.name}` : `Group tab "${t.name}"`} (${t.currency}).`,
        data: {
          tabId: t.id,
          name: target.kind === "friend" ? `You & ${target.name}` : t.name,
          isFriendTab: target.kind === "friend",
          currency: t.currency,
          people: participantSummary(t, ctx.userId),
          balances,
          suggestedTransfers,
        },
      };
    },
  }),

  defineTool({
    name: "list_expenses",
    title: "List expenses",
    description:
      "Finds expenses in a tab, newest first. Filters combine (AND) and run on the server, so use them instead of paging through everything: " +
      "amount/minAmount/maxAmount, from/to dates, paidBy, involving, search (description text) and filter (involved/owed/owe). " +
      "Examples: {tab: \"Pauri\", amount: 1967} finds that expense in one call; {tab: \"Goa Trip\", paidBy: \"sam\", from: \"2026-11\", to: \"2026-11\"} lists what Sam paid in November. " +
      "For totals (\"how much did we spend on X\", \"what's my share\") use summarize_expenses instead of adding up pages. " +
      "Amounts are in the tab's currency; originalAmount/expenseCurrency show what was entered when it differed. Deleted expenses are included unless includeDeleted is false, and are marked deleted.",
    scope: "read",
    input: z.object({
      tab: tabRef,
      ...expenseFilterShape,
      includeDeleted: z.boolean().optional().describe("Include deleted expenses (default true)."),
      limit: z.number().int().min(1).max(50).optional().describe("Default 20."),
      offset: z.number().int().min(0).optional(),
    }),
    async handler(args, ctx) {
      const target = await ctx.dir.resolveTarget(args.tab);
      const t = await ctx.dir.requireTab(target.tabId);
      const names = nameIndex(t, ctx.userId);
      const limit = args.limit ?? 20;
      const filters = queryOptions(t, args, ctx)!;
      const result = unwrap(
        await expenseService.getForTab(target.tabId, ctx.userId, {
          limit,
          offset: args.offset ?? 0,
          ...filters,
          ...(args.includeDeleted === false ? { excludeDeleted: true } : {}),
        }),
      );
      const expenses = result.expenses.map((e) => {
        const payerKey = e.paidByParticipantId ?? e.paidById;
        const yourShare = e.splits.find((s) => s.userId === ctx.userId)?.amount ?? null;
        return {
          expenseId: e.id,
          description: e.description,
          date: isoDate(e.expenseDate, ctx.timeZone),
          ...money(e.amount, t.currency),
          ...(e.currency !== t.currency
            ? { originalAmount: e.originalAmount, expenseCurrency: e.currency }
            : {}),
          paidBy: names.get(payerKey) ?? "Unknown",
          splitType: e.splitType,
          split: e.splits.map((s) => ({
            name: names.get(s.participantId ?? s.userId) ?? "Unknown",
            amount: roundMoney(s.amount, t.currency),
          })),
          yourShare: yourShare != null ? roundMoney(yourShare, t.currency) : null,
          deleted: e.deletedAt != null,
          recurring: e.recurringRuleId != null,
        };
      });
      const offset = args.offset ?? 0;
      return {
        summary: `Showing ${expenses.length} of ${result.total}${Object.keys(filters).length > 0 ? " matching" : ""} expenses in ${target.kind === "friend" ? `your tab with ${target.name}` : `"${t.name}"`}.${offset + expenses.length < result.total ? ` Pass offset ${offset + expenses.length} for more.` : ""}`,
        data: { tabId: t.id, currency: t.currency, total: result.total, expenses },
      };
    },
  }),

  defineTool({
    name: "get_expense",
    title: "Expense details",
    description:
      "Full details for one expense, including how it was split. Set includeHistory to see who changed what and when (and whether a change was made via an MCP client).",
    scope: "read",
    input: z.object({
      tab: tabRef,
      expenseId: z.string().min(1),
      includeHistory: z.boolean().optional(),
    }),
    async handler(args, ctx) {
      const target = await ctx.dir.resolveTarget(args.tab);
      const t = await ctx.dir.requireTab(target.tabId);
      const names = nameIndex(t, ctx.userId);
      const e = unwrap(await expenseService.getById(target.tabId, args.expenseId, ctx.userId));
      const history = args.includeHistory
        ? unwrap(await expenseService.getAuditLog(target.tabId, args.expenseId, ctx.userId)).map((h) => ({
            action: h.action,
            by: h.performedById === ctx.userId ? "You" : displayUser(h.performedBy),
            at: h.performedAt,
            via: h.viaMcpClient ?? null,
            changes: h.changes,
          }))
        : undefined;
      const exp = e as unknown as {
        id: string;
        description: string;
        amount: number;
        currency?: string;
        originalAmount?: number;
        expenseDate: Date;
        splitType: string;
        paidById: string;
        paidByParticipantId?: string | null;
        deletedAt?: Date | null;
        splits: Array<{ userId: string; participantId?: string | null; amount: number; weight?: number | null }>;
      };
      return {
        summary: `${exp.description}: ${roundMoney(Number(exp.amount), t.currency)} ${t.currency}.`,
        data: {
          expenseId: exp.id,
          description: exp.description,
          date: isoDate(exp.expenseDate, ctx.timeZone),
          ...money(Number(exp.amount), t.currency),
          ...(exp.currency && exp.currency !== t.currency
            ? { originalAmount: Number(exp.originalAmount), expenseCurrency: exp.currency }
            : {}),
          paidBy: names.get(exp.paidByParticipantId ?? exp.paidById) ?? "Unknown",
          splitType: exp.splitType,
          split: exp.splits.map((s) => ({
            name: names.get(s.participantId ?? s.userId) ?? "Unknown",
            participantId: s.participantId ?? null,
            amount: roundMoney(Number(s.amount), t.currency),
            weight: s.weight != null ? Number(s.weight) : null,
          })),
          deleted: exp.deletedAt != null,
          ...(history ? { history } : {}),
        },
      };
    },
  }),

  defineTool({
    name: "list_settlements",
    title: "List settlements",
    description: "Lists recorded payments (settle-ups) in a tab, newest first.",
    scope: "read",
    input: z.object({
      tab: tabRef,
      limit: z.number().int().min(1).max(50).optional().describe("Default 20."),
    }),
    async handler(args, ctx) {
      const target = await ctx.dir.resolveTarget(args.tab);
      const t = await ctx.dir.requireTab(target.tabId);
      const names = nameIndex(t, ctx.userId);
      const rows = unwrap(await tabService.getSettlementsForTab(target.tabId, ctx.userId));
      const list = rows.slice(0, args.limit ?? 20).map((s) => ({
        settlementId: s.id,
        from:
          names.get(s.fromParticipantId ?? s.fromUserId ?? "") ??
          displayUser(s.fromUser),
        to: names.get(s.toParticipantId ?? s.toUserId ?? "") ?? displayUser(s.toUser),
        ...money(Number(s.amount), t.currency),
        ...(s.currency && s.currency !== t.currency && s.originalAmount != null
          ? { originalAmount: Number(s.originalAmount), paidCurrency: s.currency }
          : {}),
        date: isoDate(s.settlementDate, ctx.timeZone),
      }));
      return {
        summary: `${rows.length} settlement${rows.length === 1 ? "" : "s"} in ${target.kind === "friend" ? `your tab with ${target.name}` : `"${t.name}"`}.`,
        data: list,
      };
    },
  }),

  defineTool({
    name: "list_recurring_expenses",
    title: "List recurring expenses",
    description:
      "Lists recurring expense rules in a tab (rent, subscriptions…): schedule, amount, status and next due date.",
    scope: "read",
    input: z.object({ tab: tabRef }),
    async handler(args, ctx) {
      const target = await ctx.dir.resolveTarget(args.tab);
      const t = await ctx.dir.requireTab(target.tabId);
      const names = nameIndex(t, ctx.userId);
      const rules = unwrap(await recurringExpenseService.listForTab(target.tabId, ctx.userId));
      return {
        summary: `${rules.length} recurring expense${rules.length === 1 ? "" : "s"}.`,
        data: rules.map((r) => {
          const tpl = r.template as {
            amount: number;
            currency: string;
            description: string;
            paidById: string;
          };
          return {
            ruleId: r.id,
            description: tpl.description,
            amount: tpl.amount,
            currency: tpl.currency,
            paidBy: names.get(tpl.paidById) ?? "Unknown",
            schedule: r.schedule,
            status: r.status,
            nextDue: r.status === "active" ? r.nextDueKey : null,
            startsOn: r.startsOn,
            endsOn: r.endsOn,
            postedCount: r.postedCount,
            maxCount: r.maxCount,
            youOwnIt: r.ownerUserId === ctx.userId,
          };
        }),
      };
    },
  }),

  defineTool({
    name: "get_activity",
    title: "Recent activity",
    description:
      "Recent activity across all tabs and friends (expenses and settlements), newest first, with the user's share of each expense.",
    scope: "read",
    input: z.object({
      limit: z.number().int().min(1).max(50).optional().describe("Default 20."),
      offset: z.number().int().min(0).optional(),
    }),
    async handler(args, ctx) {
      const result = await activity.getForUser(ctx.userId, {
        limit: args.limit ?? 20,
        offset: args.offset ?? 0,
      });
      const items = (typeof result === "object" && "items" in result ? result.items : result) as Array<
        Record<string, unknown> & { type: string }
      >;
      const out = items.map((i) => {
        const where = i.tabIsDirect
          ? `with ${displayUser(i.directOtherUser as { name: string | null; username: string | null })}`
          : String(i.tabName ?? "");
        if (i.type === "expense") {
          return {
            type: "expense",
            expenseId: i.id,
            tabId: i.tabId,
            where,
            description: i.description,
            ...money(Number(i.amount), String(i.tabCurrency)),
            paidBy:
              i.paidById === ctx.userId
                ? "You"
                : displayUser({ name: i.paidByName as string | null, username: i.paidByUsername as string | null }),
            yourShare: i.yourShare,
            date: isoDate(i.expenseDate as Date, ctx.timeZone),
            deleted: i.deletedAt != null,
            via: i.viaMcpClient ?? null,
          };
        }
        if (i.type === "settlement") {
          return {
            type: "settlement",
            settlementId: i.id,
            tabId: i.tabId,
            where,
            from: i.fromUserId === ctx.userId ? "You" : (i.fromUserName ?? "Unknown"),
            to: i.toUserId === ctx.userId ? "You" : (i.toUserName ?? "Unknown"),
            ...money(Number(i.amount), String(i.tabCurrency)),
            date: isoDate(i.settlementDate as Date, ctx.timeZone),
            via: i.viaMcpClient ?? null,
          };
        }
        return { type: i.type, tabId: i.tabId, where, date: isoDate(i.createdAt as Date, ctx.timeZone) };
      });
      return { summary: `${out.length} recent item${out.length === 1 ? "" : "s"}.`, data: out };
    },
  }),

  defineTool({
    name: "list_pending_requests",
    title: "Pending requests",
    description:
      "Incoming friend requests and tab invites waiting for the user's answer. Respond with respond_to_request.",
    scope: "read",
    input: z.object({}),
    async handler(_args, ctx) {
      const [friends, invites] = await Promise.all([
        friendService.getPendingRequests(ctx.userId),
        tabInviteService.getPendingRequests(ctx.userId),
      ]);
      const fr = unwrap(friends).requests.map((r) => ({
        kind: "friend_request" as const,
        requestId: r.id,
        from: displayUser({ name: r.fromUserName, username: r.fromUserUsername }),
        username: r.fromUserUsername,
        createdAt: isoDate(r.createdAt, ctx.timeZone),
      }));
      const ti = unwrap(invites).requests.map((r) => ({
        kind: "tab_invite" as const,
        requestId: r.id,
        tab: r.tabName,
        from: displayUser({ name: r.fromUserName, username: r.fromUserUsername }),
        createdAt: isoDate(r.createdAt, ctx.timeZone),
      }));
      return {
        summary: `${fr.length} friend request${fr.length === 1 ? "" : "s"}, ${ti.length} tab invite${ti.length === 1 ? "" : "s"}.`,
        data: [...fr, ...ti],
      };
    },
  }),

  defineTool({
    name: "preview_currency_conversion",
    title: "Preview currency conversion",
    description:
      "Shows what an amount in another currency becomes in a tab's currency, using the same exchange rate Tab will apply when the expense is saved (ECB rates for the expense date).",
    scope: "read",
    input: z.object({
      tab: tabRef,
      amount: z.number().positive(),
      currency: z.string().length(3).describe("ISO 4217 code, e.g. EUR."),
      date: z.string().optional().describe("Expense date, YYYY-MM-DD. Default today."),
    }),
    async handler(args, ctx) {
      const target = await ctx.dir.resolveTarget(args.tab);
      const t = await ctx.dir.requireTab(target.tabId);
      const from = args.currency.toUpperCase();
      if (!(CURRENCY_CODES as readonly string[]).includes(from)) {
        throw new ToolError(`Unsupported currency code ${from}`);
      }
      let asOf: Date;
      try {
        asOf = parseDateArg(args.date, "date") ?? new Date();
      } catch (e) {
        throw new ToolError((e as Error).message);
      }
      const conv = await convertToTabCurrency({
        originalAmount: args.amount,
        from,
        tabCurrency: t.currency,
        asOfDate: asOf,
      });
      if (!conv.success) throw new ToolError(String(conv.error));
      return {
        summary: `${args.amount} ${from} ≈ ${conv.data.amountTab} ${t.currency} (rate date ${conv.data.rateDate}).`,
        data: {
          from: { amount: args.amount, currency: from },
          to: money(conv.data.amountTab, t.currency),
          rateDate: conv.data.rateDate,
        },
      };
    },
  }),
];
