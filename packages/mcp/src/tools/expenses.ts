import { z } from "zod";
import { createExpenseSchema } from "models";
import { convertToTabCurrency, expenseService } from "services";
import type { TabWithMembers } from "data";
import { ToolError, unwrap } from "../context.js";
import { defineTool, type ToolContext } from "../tool.js";
import { isoDate, money, parseDateArg, roundMoney } from "../format.js";
import { nameIndex, participantName, resolveParticipant, type Participant } from "../resolve.js";

const tabRef = z
  .string()
  .min(1)
  .describe(
    "Which tab: a tab id, a group tab's name, or a friend's username/name for your 1:1 tab with them.",
  );

const personRef = z
  .string()
  .min(1)
  .describe('A person in the tab: "me", a username, a name, or a participantId from get_tab.');

const splitLine = z.object({
  person: personRef,
  amount: z
    .number()
    .positive()
    .optional()
    .describe("For splitType=custom: this person's share, in the expense's `currency`."),
  percent: z.number().positive().max(100).optional().describe("For splitType=percent: 0–100."),
  shares: z.number().int().positive().optional().describe("For splitType=shares: whole number of shares."),
});

const SPLIT_HELP =
  "Split rules: equal (default) divides among `participants` (default: everyone in the tab). " +
  "custom/percent/shares need `splits` with one line per person (custom amounts are in the expense's `currency` and must add up to `amount`; percents to 100). " +
  "Placeholders (people not on Tab yet) can only be in equal splits.";

type SplitLine = z.infer<typeof splitLine>;

function badInput(e: unknown): never {
  throw new ToolError(e instanceof Error ? e.message : String(e));
}

function requireMemberUser(p: Participant, splitType: string): string {
  if (!p.userId || p.kind === "placeholder") {
    throw new ToolError(
      `${participantName(p)} is a placeholder; ${splitType} splits only work with people who have a Tab account. Use an equal split or ask the user.`,
    );
  }
  return p.userId;
}

/** Turns friendly split arguments into the service's `splits`/`participantIds`. */
function buildSplit(
  t: TabWithMembers,
  userId: string,
  splitType: "equal" | "custom" | "percent" | "shares",
  participants: string[] | undefined,
  splits: SplitLine[] | undefined,
): { participantIds?: string[]; splits?: Array<{ userId: string; amount?: number; weight?: number }> } {
  if (splitType === "equal") {
    if (splits?.length) {
      throw new ToolError("For an equal split pass `participants`, not `splits`.");
    }
    if (!participants?.length) return {};
    const ids = [...new Set(participants.map((p) => resolveParticipant(t, p, userId, true).id))];
    return { participantIds: ids };
  }
  if (!splits?.length) {
    throw new ToolError(`splitType=${splitType} needs a \`splits\` array (one line per person).`);
  }
  const lines = splits.map((line) => {
    const p = resolveParticipant(t, line.person, userId, true);
    const uid = requireMemberUser(p, splitType);
    if (splitType === "custom") {
      if (line.amount === undefined) throw new ToolError(`Missing amount for ${participantName(p)}.`);
      return { participantId: p.id, userId: uid, amount: line.amount };
    }
    if (splitType === "percent") {
      if (line.percent === undefined) throw new ToolError(`Missing percent for ${participantName(p)}.`);
      return { participantId: p.id, userId: uid, weight: line.percent };
    }
    if (line.shares === undefined) throw new ToolError(`Missing shares for ${participantName(p)}.`);
    return { participantId: p.id, userId: uid, weight: line.shares };
  });
  return {
    participantIds: lines.map((l) => l.participantId),
    splits: lines.map(({ participantId: _p, ...rest }) => rest),
  };
}

type SplitRow = { userId: string; amount?: number; weight?: number };

/** Scales custom split amounts so they add up to `total` exactly (2 dp, remainder on the last line). */
function rescaleCustom(splits: SplitRow[], total: number): SplitRow[] {
  const sum = splits.reduce((a, l) => a + (l.amount ?? 0), 0);
  if (sum <= 0) throw new ToolError("Custom split amounts must be positive.");
  const cents = Math.round(total * 100);
  let assigned = 0;
  return splits.map((l, i) => {
    const c =
      i === splits.length - 1
        ? cents - assigned
        : Math.round(((l.amount ?? 0) / sum) * cents);
    assigned += c;
    return { ...l, amount: c / 100 };
  });
}

/** Tab-currency total for an amount entered in `currency` (same rate the service will use). */
async function totalInTabCurrency(
  amount: number,
  currency: string,
  tabCurrency: string,
  date: Date,
): Promise<number> {
  if (currency === tabCurrency) return amount;
  const conv = await convertToTabCurrency({
    originalAmount: amount,
    from: currency,
    tabCurrency,
    asOfDate: date,
  });
  if (!conv.success) throw new ToolError(String(conv.error));
  return conv.data.amountTab;
}

/**
 * Custom amounts arrive in the expense's currency; the service stores and
 * checks splits in the tab's currency. Validate against the entered total,
 * then convert proportionally so they sum to the converted total exactly.
 */
async function customSplitsToTabCurrency(
  splits: SplitRow[],
  amount: number,
  currency: string,
  tabCurrency: string,
  date: Date,
): Promise<SplitRow[]> {
  const sum = splits.reduce((a, l) => a + (l.amount ?? 0), 0);
  if (Math.abs(sum - amount) > 0.01) {
    throw new ToolError(
      `Custom amounts add up to ${roundMoney(sum, currency)} ${currency} but the expense total is ${amount} ${currency}.`,
    );
  }
  if (currency === tabCurrency) return splits;
  return rescaleCustom(splits, await totalInTabCurrency(amount, currency, tabCurrency, date));
}

function validate(body: Record<string, unknown>) {
  const parsed = createExpenseSchema.safeParse(body);
  if (!parsed.success) {
    const flat = parsed.error.flatten();
    throw new ToolError(
      flat.formErrors[0] ?? Object.values(flat.fieldErrors).flat()[0] ?? "Invalid expense",
    );
  }
  return parsed.data;
}

async function payerFields(t: TabWithMembers, ref: string | undefined, ctx: ToolContext) {
  const payer = resolveParticipant(t, ref ?? "me", ctx.userId, ctx.strict);
  return payer.userId && payer.kind !== "placeholder"
    ? { paidById: payer.userId, payer }
    : { paidByParticipantId: payer.id, payer };
}

export const expenseTools = [
  defineTool({
    name: "create_expense",
    title: "Add an expense",
    description:
      "Adds an expense to a group tab or to the 1:1 tab with a friend. Everyone in the split is notified, and the expense is labelled as added via this app. " +
      "Confirm amount, payer and split with the user if anything is unclear. Never guess between similarly named people or tabs; if the tool returns candidates, ask the user. " +
      SPLIT_HELP,
    scope: "write",
    input: z.object({
      tab: tabRef,
      description: z.string().min(1).max(500).describe('What it was for, e.g. "Dinner at Toit".'),
      amount: z.number().positive().describe("Total amount, in `currency`."),
      currency: z
        .string()
        .length(3)
        .optional()
        .describe("ISO 4217 code. Defaults to the tab's currency; other currencies are converted at the expense date's rate."),
      date: z.string().optional().describe("YYYY-MM-DD. Defaults to today."),
      paidBy: personRef.optional().describe('Who paid. Defaults to "me".'),
      splitType: z.enum(["equal", "custom", "percent", "shares"]).optional(),
      participants: z
        .array(personRef)
        .optional()
        .describe("For equal splits: who shares the cost (include the payer if they share it). Default: everyone in the tab."),
      splits: z.array(splitLine).optional(),
    }),
    annotations: { destructiveHint: false, idempotentHint: false },
    async handler(args, ctx) {
      const target = await ctx.dir.resolveTarget(args.tab, ctx.strict);
      const t = await ctx.dir.requireTab(target.tabId);
      const splitType = args.splitType ?? "equal";
      const { payer, ...payerIds } = await payerFields(t, args.paidBy, ctx);
      const split = buildSplit(t, ctx.userId, splitType, args.participants, args.splits);
      let expenseDate: Date | undefined;
      try {
        expenseDate = parseDateArg(args.date, "date");
      } catch (e) {
        badInput(e);
      }
      const currency = args.currency?.toUpperCase() ?? t.currency;
      const splitsTab =
        splitType === "custom" && split.splits
          ? await customSplitsToTabCurrency(split.splits, args.amount, currency, t.currency, expenseDate ?? new Date())
          : split.splits;
      const parsed = validate({
        tabId: target.tabId,
        amount: args.amount,
        currency,
        description: args.description.trim(),
        ...payerIds,
        splitType,
        ...(expenseDate ? { expenseDate } : {}),
        ...(splitsTab ? { splits: splitsTab } : {}),
      });
      const created = unwrap(
        await expenseService.create({ ...parsed, participantIds: split.participantIds }, ctx.userId),
      );
      const names = nameIndex(t, ctx.userId);
      return {
        summary: `Added "${created.description}" (${roundMoney(created.amount, created.currency)} ${created.currency}) to ${target.kind === "friend" ? `your tab with ${target.name}` : `"${t.name}"`}, paid by ${payer.userId === ctx.userId ? "you" : participantName(payer)}.`,
        data: {
          expenseId: created.expenseId,
          tabId: created.tabId,
          ...money(created.amount, created.currency),
          ...(created.expenseCurrency !== created.currency
            ? { originalAmount: created.originalAmount, expenseCurrency: created.expenseCurrency, fxRateDate: created.fxRateDate }
            : {}),
          date: isoDate(expenseDate ?? new Date(), ctx.timeZone),
          split: created.participants.map((p) => ({
            name: names.get(p.userId) ?? p.name ?? "Unknown",
            ...(p.paid !== undefined ? { paid: roundMoney(p.paid, created.currency) } : {}),
            ...(p.owes !== undefined ? { owes: roundMoney(p.owes, created.currency) } : {}),
          })),
        },
      };
    },
  }),

  defineTool({
    name: "update_expense",
    title: "Edit an expense",
    description:
      "Edits an expense. Pass only the fields to change; everything else keeps its current value. " +
      "If you change the amount of a custom split, also pass new `splits` (in the expense's currency). " +
      SPLIT_HELP,
    scope: "write",
    input: z.object({
      tab: tabRef,
      expenseId: z.string().min(1),
      description: z.string().min(1).max(500).optional(),
      amount: z.number().positive().optional().describe("New total, in `currency` (or the expense's current currency)."),
      currency: z.string().length(3).optional(),
      date: z.string().optional().describe("YYYY-MM-DD."),
      paidBy: personRef.optional(),
      splitType: z.enum(["equal", "custom", "percent", "shares"]).optional(),
      participants: z.array(personRef).optional(),
      splits: z.array(splitLine).optional(),
    }),
    annotations: { destructiveHint: false, idempotentHint: true },
    async handler(args, ctx) {
      const target = await ctx.dir.resolveTarget(args.tab, ctx.strict);
      const t = await ctx.dir.requireTab(target.tabId);
      const existing = unwrap(await expenseService.getById(target.tabId, args.expenseId, ctx.userId)) as unknown as {
        description: string;
        amount: string | number;
        currency: string;
        originalAmount: string | number;
        expenseDate: Date;
        splitType: "equal" | "custom" | "percent" | "shares";
        paidById: string | null;
        paidByParticipantId: string | null;
        deletedAt: Date | null;
        splits: Array<{ userId: string | null; participantId: string | null; amount: string | number; weight: string | number | null }>;
      };
      if (existing.deletedAt) {
        throw new ToolError("This expense is deleted. Restore it first with restore_expense.");
      }

      const splitChanged = args.splitType !== undefined || args.participants !== undefined || args.splits !== undefined;
      const splitType = args.splitType ?? existing.splitType;
      let split: ReturnType<typeof buildSplit>;
      if (splitChanged) {
        split = buildSplit(t, ctx.userId, splitType, args.participants, args.splits);
      } else if (splitType === "equal") {
        split = {
          participantIds: existing.splits.map((s) => s.participantId).filter((x): x is string => !!x),
        };
      } else {
        if (splitType === "custom" && args.amount !== undefined) {
          throw new ToolError("This expense uses custom amounts; pass new `splits` that add up to the new amount.");
        }
        split = {
          participantIds: existing.splits.map((s) => s.participantId).filter((x): x is string => !!x),
          splits: existing.splits
            .filter((s) => s.userId)
            .map((s) =>
              splitType === "custom"
                ? { userId: s.userId!, amount: Number(s.amount) }
                : { userId: s.userId!, weight: Number(s.weight) },
            ),
        };
      }

      let payerIds: { paidById?: string; paidByParticipantId?: string };
      if (args.paidBy) {
        const { payer: _p, ...ids } = await payerFields(t, args.paidBy, ctx);
        payerIds = ids;
      } else {
        payerIds = existing.paidByParticipantId
          ? { paidByParticipantId: existing.paidByParticipantId }
          : { paidById: existing.paidById ?? ctx.userId };
      }

      let expenseDate: Date | undefined;
      try {
        expenseDate = parseDateArg(args.date, "date");
      } catch (e) {
        badInput(e);
      }
      const amount = args.amount ?? Number(existing.originalAmount);
      const currency = (args.currency ?? existing.currency).toUpperCase();
      const date = expenseDate ?? existing.expenseDate;
      let splitsTab = split.splits;
      if (splitType === "custom" && split.splits) {
        splitsTab = splitChanged
          ? // New amounts from the model are in the expense's currency.
            await customSplitsToTabCurrency(split.splits, amount, currency, t.currency, date)
          : // Kept amounts are stored in tab currency; the converted total can
            // shift (new currency/date or a refreshed rate), so keep their
            // proportions and make them sum to the new total.
            rescaleCustom(split.splits, await totalInTabCurrency(amount, currency, t.currency, date));
      }
      const parsed = validate({
        tabId: target.tabId,
        amount,
        currency,
        description: (args.description ?? existing.description).trim(),
        ...payerIds,
        splitType,
        expenseDate: date,
        ...(splitsTab ? { splits: splitsTab } : {}),
      });
      unwrap(
        await expenseService.update(
          target.tabId,
          args.expenseId,
          { ...parsed, participantIds: split.participantIds },
          ctx.userId,
        ),
      );
      return {
        summary: `Updated "${parsed.description}".`,
        data: { expenseId: args.expenseId, tabId: target.tabId },
      };
    },
  }),

  defineTool({
    name: "delete_expense",
    title: "Delete an expense",
    description:
      "Deletes an expense (soft delete: it can be brought back with restore_expense). Confirm with the user before deleting.",
    scope: "write",
    input: z.object({ tab: tabRef, expenseId: z.string().min(1) }),
    annotations: { destructiveHint: true, idempotentHint: true },
    async handler(args, ctx) {
      const target = await ctx.dir.resolveTarget(args.tab, ctx.strict);
      unwrap(await expenseService.delete(target.tabId, args.expenseId, ctx.userId));
      return {
        summary: "Expense deleted. It can be restored with restore_expense.",
        data: { expenseId: args.expenseId, tabId: target.tabId },
      };
    },
  }),

  defineTool({
    name: "restore_expense",
    title: "Restore a deleted expense",
    description: "Brings back an expense that was deleted.",
    scope: "write",
    input: z.object({ tab: tabRef, expenseId: z.string().min(1) }),
    annotations: { destructiveHint: false, idempotentHint: true },
    async handler(args, ctx) {
      const target = await ctx.dir.resolveTarget(args.tab, ctx.strict);
      unwrap(await expenseService.restore(target.tabId, args.expenseId, ctx.userId));
      return { summary: "Expense restored.", data: { expenseId: args.expenseId, tabId: target.tabId } };
    },
  }),
];
