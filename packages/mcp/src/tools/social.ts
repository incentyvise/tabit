import { z } from "zod";
import {
  friendService,
  recurringExpenseService,
  tabInviteService,
  tabService,
} from "services";
import { paymentReminderToneSchema, type PaymentReminderTone } from "models";
import { CURRENCY_CODES } from "shared";
import { ToolError, unwrap } from "../context.js";
import { defineTool } from "../tool.js";
import { todayIso } from "../format.js";
import { participantName, resolveParticipant } from "../resolve.js";

const tabRef = z
  .string()
  .min(1)
  .describe(
    "Which tab: a tab id, a group tab's name, or a friend's username/name for your 1:1 tab with them.",
  );
const friendRef = z.string().min(1).describe("A friend's username or name (see list_friends).");
const personRef = z
  .string()
  .min(1)
  .describe('A person in the tab: "me", a username, a name, or a participantId from get_tab.');

function currencyOrThrow(c: string | undefined): string | undefined {
  if (!c) return undefined;
  const up = c.toUpperCase();
  if (!(CURRENCY_CODES as readonly string[]).includes(up)) throw new ToolError(`Unsupported currency code ${up}`);
  return up;
}

const scheduleInput = z
  .discriminatedUnion("type", [
    z.object({
      type: z.literal("monthly"),
      dayOfMonth: z.number().int().min(1).max(31).describe("Day of the month (31 = last day in short months)."),
    }),
    z.object({
      type: z.literal("weekly"),
      weekdays: z
        .array(z.enum(["mon", "tue", "wed", "thu", "fri", "sat", "sun"]))
        .min(1)
        .describe("Days of the week it repeats on."),
    }),
    z.object({
      type: z.literal("every_n_days"),
      days: z.number().int().min(1).max(365),
      startDate: z.string().optional().describe("YYYY-MM-DD of the first occurrence. Default: startsOn."),
    }),
  ])
  .describe("How often it repeats.");

const WEEKDAY: Record<string, number> = { mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6, sun: 7 };

function toSchedule(s: z.infer<typeof scheduleInput>, startsOn: string) {
  if (s.type === "monthly") return { type: "monthly_nth" as const, dayOfMonth: s.dayOfMonth };
  if (s.type === "weekly") return { type: "weekly" as const, weekdays: [...new Set(s.weekdays.map((d) => WEEKDAY[d]!))] };
  return { type: "interval_days" as const, intervalDays: s.days, anchorDate: s.startDate ?? startsOn };
}

const isoDay = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD");

export const socialTools = [
  // ── Tabs ──────────────────────────────────────────────────────────────
  defineTool({
    name: "create_tab",
    title: "Create a group tab",
    description:
      "Creates a new group tab (a trip, flat, event…) with the user as owner. Add people afterwards with invite_to_tab or add_placeholder.",
    scope: "write",
    input: z.object({
      name: z.string().trim().min(1).max(100),
      currency: z.string().length(3).optional().describe("ISO 4217 code. Default: the user's default currency."),
    }),
    async handler(args, ctx) {
      const { tabId } = unwrap(await tabService.create(args.name, ctx.userId, currencyOrThrow(args.currency)));
      return { summary: `Created tab "${args.name}".`, data: { tabId, name: args.name } };
    },
  }),

  defineTool({
    name: "update_tab",
    title: "Rename a tab or change its currency",
    description: "Renames a group tab and/or changes its currency.",
    scope: "write",
    input: z.object({
      tab: tabRef,
      name: z.string().trim().min(1).max(100).optional(),
      currency: z.string().length(3).optional(),
    }),
    annotations: { idempotentHint: true },
    async handler(args, ctx) {
      if (args.name === undefined && args.currency === undefined) {
        throw new ToolError("Pass a new name and/or currency.");
      }
      const target = await ctx.dir.resolveTarget(args.tab, ctx.strict);
      unwrap(
        await tabService.update(target.tabId, ctx.userId, {
          ...(args.name !== undefined ? { name: args.name } : {}),
          ...(args.currency !== undefined ? { currency: currencyOrThrow(args.currency)! } : {}),
        }),
      );
      return { summary: "Tab updated.", data: { tabId: target.tabId } };
    },
  }),

  defineTool({
    name: "invite_to_tab",
    title: "Invite someone to a tab",
    description:
      "Invites a Tab user (by username) to a group tab. They join once they accept. For someone without a Tab account, use add_placeholder.",
    scope: "write",
    input: z.object({
      tab: tabRef,
      username: z.string().min(1).describe("Their Tab username, with or without @."),
    }),
    async handler(args, ctx) {
      const target = await ctx.dir.resolveTarget(args.tab, ctx.strict);
      if (target.kind === "friend") throw new ToolError("1:1 friend tabs can't have more people. Create a group tab instead.");
      const username = args.username.trim().replace(/^@/, "");
      unwrap(await tabInviteService.sendRequest(ctx.userId, target.tabId, username));
      return { summary: `Invited @${username} to "${target.name}".`, data: { tabId: target.tabId } };
    },
  }),

  defineTool({
    name: "add_placeholder",
    title: "Add someone without a Tab account",
    description:
      "Adds a named placeholder to a group tab for someone who isn't on Tab yet. They can be included in equal splits and settlements, and merged into their real account later from the app.",
    scope: "write",
    input: z.object({
      tab: tabRef,
      name: z.string().trim().min(1).max(80),
    }),
    async handler(args, ctx) {
      const target = await ctx.dir.resolveTarget(args.tab, ctx.strict);
      if (target.kind === "friend") throw new ToolError("Placeholders can only be added to group tabs.");
      const { participantId } = unwrap(await tabService.createPlaceholder(target.tabId, ctx.userId, args.name));
      return {
        summary: `Added ${args.name} to "${target.name}" as a placeholder.`,
        data: { tabId: target.tabId, participantId },
      };
    },
  }),

  // ── Recurring expenses ───────────────────────────────────────────────
  defineTool({
    name: "create_recurring_expense",
    title: "Set up a recurring expense",
    description:
      "Creates a recurring expense (rent, subscriptions…) that Tab posts automatically on schedule, split equally among `participants` (default: everyone in the tab).",
    scope: "write",
    input: z.object({
      tab: tabRef,
      description: z.string().min(1).max(500),
      amount: z.number().positive(),
      currency: z.string().length(3).optional().describe("Default: the tab's currency."),
      paidBy: z.string().optional().describe('Who pays each time: "me" (default) or a username/name of a tab member.'),
      participants: z.array(personRef).optional(),
      schedule: scheduleInput,
      startsOn: isoDay.optional().describe("First possible date. Default today."),
      endsOn: isoDay.optional(),
      maxCount: z.number().int().positive().optional().describe("Stop after this many occurrences."),
    }),
    async handler(args, ctx) {
      const target = await ctx.dir.resolveTarget(args.tab, ctx.strict);
      const t = await ctx.dir.requireTab(target.tabId);
      const payer = resolveParticipant(t, args.paidBy ?? "me", ctx.userId, ctx.strict);
      if (!payer.userId) throw new ToolError("Recurring expenses must be paid by someone with a Tab account.");
      const participantIds = args.participants?.length
        ? [...new Set(args.participants.map((p) => resolveParticipant(t, p, ctx.userId, ctx.strict).id))]
        : t.participants.map((p) => p.id);
      const startsOn = args.startsOn ?? todayIso(ctx.timeZone);
      const { ruleId } = unwrap(
        await recurringExpenseService.create(target.tabId, ctx.userId, {
          schedule: toSchedule(args.schedule, startsOn),
          template: {
            amount: args.amount,
            currency: currencyOrThrow(args.currency) ?? t.currency,
            description: args.description.trim(),
            paidById: payer.userId,
            splitType: "equal",
            participantIds,
          },
          startsOn,
          ...(args.endsOn ? { endsOn: args.endsOn } : {}),
          ...(args.maxCount ? { maxCount: args.maxCount } : {}),
        }),
      );
      return {
        summary: `Recurring expense "${args.description}" set up in ${target.kind === "friend" ? `your tab with ${target.name}` : `"${t.name}"`}, paid by ${payer.userId === ctx.userId ? "you" : participantName(payer)}.`,
        data: { ruleId, tabId: target.tabId },
      };
    },
  }),

  defineTool({
    name: "update_recurring_expense",
    title: "Change, pause or resume a recurring expense",
    description:
      "Pauses or resumes a recurring expense, or changes its amount, description, schedule or end. Only the person who created it can change it.",
    scope: "write",
    input: z.object({
      ruleId: z.string().min(1).describe("From list_recurring_expenses."),
      status: z.enum(["active", "paused"]).optional(),
      description: z.string().min(1).max(500).optional(),
      amount: z.number().positive().optional(),
      schedule: scheduleInput.optional(),
      endsOn: isoDay.nullable().optional().describe("null removes the end date."),
      maxCount: z.number().int().positive().nullable().optional(),
    }),
    annotations: { idempotentHint: true },
    async handler(args, ctx) {
      const rule = unwrap(await recurringExpenseService.getById(args.ruleId, ctx.userId));
      const patch: Record<string, unknown> = {};
      if (args.status) patch.status = args.status === "active" ? "active" : "paused_user";
      if (args.description !== undefined || args.amount !== undefined) {
        const tpl = rule.template as Record<string, unknown>;
        patch.template = {
          ...tpl,
          ...(args.description !== undefined ? { description: args.description.trim() } : {}),
          ...(args.amount !== undefined ? { amount: args.amount } : {}),
        };
      }
      if (args.schedule) patch.schedule = toSchedule(args.schedule, rule.startsOn);
      if (args.endsOn !== undefined) patch.endsOn = args.endsOn;
      if (args.maxCount !== undefined) patch.maxCount = args.maxCount;
      if (Object.keys(patch).length === 0) throw new ToolError("Nothing to change.");
      unwrap(await recurringExpenseService.update(args.ruleId, ctx.userId, patch));
      return { summary: "Recurring expense updated.", data: { ruleId: args.ruleId } };
    },
  }),

  defineTool({
    name: "delete_recurring_expense",
    title: "Delete a recurring expense",
    description:
      "Stops and deletes a recurring expense rule. Expenses it already posted stay. Confirm with the user first; pausing is an alternative.",
    scope: "write",
    input: z.object({ ruleId: z.string().min(1) }),
    annotations: { destructiveHint: true, idempotentHint: true },
    async handler(args, ctx) {
      unwrap(await recurringExpenseService.deleteRule(args.ruleId, ctx.userId));
      return { summary: "Recurring expense deleted.", data: { ruleId: args.ruleId } };
    },
  }),

  // ── Friends ──────────────────────────────────────────────────────────
  defineTool({
    name: "send_friend_request",
    title: "Send a friend request",
    description: "Sends a friend request to a Tab user by username.",
    scope: "write",
    input: z.object({ username: z.string().min(1).describe("Their Tab username, with or without @.") }),
    async handler(args, ctx) {
      const username = args.username.trim().replace(/^@/, "");
      unwrap(await friendService.sendRequest(ctx.userId, username));
      return { summary: `Friend request sent to @${username}.` };
    },
  }),

  defineTool({
    name: "respond_to_request",
    title: "Accept or decline a request",
    description: "Accepts or declines an incoming friend request or tab invite from list_pending_requests.",
    scope: "write",
    input: z.object({
      kind: z.enum(["friend_request", "tab_invite"]),
      requestId: z.string().min(1),
      accept: z.boolean(),
    }),
    async handler(args, ctx) {
      if (args.kind === "friend_request") {
        if (args.accept) {
          const { friendTabId } = unwrap(await friendService.acceptRequest(args.requestId, ctx.userId));
          return { summary: "Friend request accepted.", data: { friendTabId } };
        }
        unwrap(await friendService.rejectRequest(args.requestId, ctx.userId));
        return { summary: "Friend request declined." };
      }
      if (args.accept) {
        const { tabId } = unwrap(await tabInviteService.acceptRequest(ctx.userId, args.requestId));
        return { summary: "Tab invite accepted.", data: { tabId } };
      }
      unwrap(await tabInviteService.rejectRequest(ctx.userId, args.requestId));
      return { summary: "Tab invite declined." };
    },
  }),

  defineTool({
    name: "poke_friend",
    title: "Poke a friend",
    description:
      "Sends a friend a playful poke notification on their phone. Only when the user explicitly asks. Limited to one poke per friend every 10 minutes.",
    scope: "write",
    input: z.object({ friend: friendRef }),
    annotations: { openWorldHint: true },
    async handler(args, ctx) {
      const f = await ctx.dir.resolveFriend(args.friend, ctx.strict);
      unwrap(await friendService.poke(ctx.userId, f.tabId));
      return { summary: `Poked ${f.name}.` };
    },
  }),

  defineTool({
    name: "send_payment_reminder",
    title: "Remind a friend to pay",
    description:
      "Sends a friend a push notification reminding them what they owe the user. Only works when the friend owes the user in your 1:1 tab, and only when the user explicitly asks. Limited to one reminder per friend per day.",
    scope: "write",
    input: z.object({
      friend: friendRef,
      tone: z.enum(paymentReminderToneSchema.options as [PaymentReminderTone, ...PaymentReminderTone[]]).optional().describe("How the reminder reads. Default: gentle."),
    }),
    annotations: { openWorldHint: true },
    async handler(args, ctx) {
      const f = await ctx.dir.resolveFriend(args.friend, ctx.strict);
      unwrap(await friendService.sendPaymentReminder(ctx.userId, f.tabId, args.tone ?? "gentle"));
      return { summary: `Payment reminder sent to ${f.name}.` };
    },
  }),
];
