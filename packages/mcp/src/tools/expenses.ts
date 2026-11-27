import { z } from "zod";
import { createExpenseSchema } from "models";
import { convertToTabCurrency, expenseService } from "services";
import type { TabWithMembers } from "data";
import { ToolError, unwrap } from "../context.js";
import { defineTool, type ToolContext } from "../tool.js";
import { isoDate, money, parseDateArg, roundMoney } from "../format.js";
import { nameIndex, participantName, resolveParticipant, type Participant } from "../resolve.js";
import {
  possibleDuplicatesOf,
  similarAmounts,
  similarDescriptions,
  tabRef,
  type TabExpense,
} from "../expense-query.js";

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

const expenseLineShape = {
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
  splitLike: z
    .string()
    .min(1)
    .optional()
    .describe(
      "An expenseId in the same tab to copy the split from (same people, split type and proportions, scaled to this amount). " +
        "Use it for repeating custom splits like rent: find last month's with list_expenses {search: \"rent\", limit: 1}. Don't combine with splitType/participants/splits.",
    ),
};

const expenseLine = z.object(expenseLineShape);
type ExpenseLine = z.infer<typeof expenseLine>;

type StoredExpense = {
  id: string;
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

async function loadExpense(tabId: string, expenseId: string, ctx: ToolContext): Promise<StoredExpense> {
  return unwrap(await expenseService.getById(tabId, expenseId, ctx.userId)) as unknown as StoredExpense;
}

/** Copies another expense's split, re-scaled to a new total (custom amounts come back in tab currency). */
async function splitFromExpense(
  tabId: string,
  expenseId: string,
  amount: number,
  currency: string,
  tabCurrency: string,
  date: Date,
  ctx: ToolContext,
): Promise<{ splitType: ExpenseLine["splitType"] & string; participantIds: string[]; splitsTab?: SplitRow[] }> {
  const src = await loadExpense(tabId, expenseId, ctx);
  const participantIds = src.splits.map((s) => s.participantId).filter((x): x is string => !!x);
  if (src.splitType === "equal") return { splitType: "equal", participantIds };
  const rows = src.splits.filter((s) => s.userId);
  if (src.splitType === "custom") {
    const total = await totalInTabCurrency(amount, currency, tabCurrency, date);
    return {
      splitType: "custom",
      participantIds,
      splitsTab: rescaleCustom(rows.map((s) => ({ userId: s.userId!, amount: Number(s.amount) })), total),
    };
  }
  return {
    splitType: src.splitType,
    participantIds,
    splitsTab: rows.map((s) => ({ userId: s.userId!, weight: Number(s.weight) })),
  };
}

type PreparedExpense = {
  body: ReturnType<typeof validate> & { participantIds?: string[] };
  payer: Participant;
  expenseDate: Date;
  currency: string;
};

/** Resolves names, the split and currency for one expense line and validates it, without writing anything. */
async function prepareExpense(t: TabWithMembers, line: ExpenseLine, ctx: ToolContext): Promise<PreparedExpense> {
  const { payer, ...payerIds } = await payerFields(t, line.paidBy, ctx);
  let expenseDate: Date | undefined;
  try {
    expenseDate = parseDateArg(line.date, "date");
  } catch (e) {
    badInput(e);
  }
  const date = expenseDate ?? new Date();
  const currency = line.currency?.toUpperCase() ?? t.currency;

  let splitType: "equal" | "custom" | "percent" | "shares";
  let participantIds: string[] | undefined;
  let splitsTab: SplitRow[] | undefined;
  if (line.splitLike) {
    if (line.splitType || line.participants || line.splits) {
      throw new ToolError("Pass either splitLike or splitType/participants/splits, not both.");
    }
    const copied = await splitFromExpense(t.id, line.splitLike, line.amount, currency, t.currency, date, ctx);
    splitType = copied.splitType;
    participantIds = copied.participantIds;
    splitsTab = copied.splitsTab;
  } else {
    splitType = line.splitType ?? "equal";
    const split = buildSplit(t, ctx.userId, splitType, line.participants, line.splits);
    participantIds = split.participantIds;
    splitsTab =
      splitType === "custom" && split.splits
        ? await customSplitsToTabCurrency(split.splits, line.amount, currency, t.currency, date)
        : split.splits;
  }
  const parsed = validate({
    tabId: t.id,
    amount: line.amount,
    currency,
    description: line.description.trim(),
    ...payerIds,
    splitType,
    expenseDate: date,
    ...(splitsTab ? { splits: splitsTab } : {}),
  });
  return { body: { ...parsed, participantIds }, payer, expenseDate: date, currency };
}

function duplicateBrief(e: TabExpense, names: Map<string, string>, tabCurrency: string, ctx: ToolContext) {
  return {
    expenseId: e.id,
    description: e.description,
    date: isoDate(e.expenseDate, ctx.timeZone),
    amount: roundMoney(Number(e.amount), tabCurrency),
    paidBy: names.get(e.paidByParticipantId ?? e.paidById) ?? "Unknown",
  };
}

const DUPLICATE_HELP =
  "If an expense with a similar amount and description already exists within 3 days, nothing is added and the matches come back: show them to the user and only retry with allowDuplicate: true if they confirm it's a separate expense.";

export const expenseTools = [
  defineTool({
    name: "create_expense",
    title: "Add an expense",
    description:
      "Adds an expense to a group tab or to the 1:1 tab with a friend. Everyone in the split and the payer is notified, and the expense is labelled as added via this app. " +
      "Confirm amount, payer and split with the user if anything is unclear. Never guess between similarly named people or tabs; if the tool returns candidates, ask the user. " +
      "For several expenses at once use create_expenses. " +
      DUPLICATE_HELP +
      " " +
      SPLIT_HELP +
      ' To repeat a split from an earlier expense (e.g. rent at 37000/13000), pass splitLike with that expenseId: {tab: "Pauri", description: "Rent December", amount: 50000, splitLike: "<last rent expenseId>"}.',
    scope: "write",
    input: z.object({
      tab: tabRef,
      ...expenseLineShape,
      allowDuplicate: z
        .boolean()
        .optional()
        .describe("Add it even if a similar expense exists. Only after the user confirms it isn't a duplicate."),
    }),
    annotations: { destructiveHint: false, idempotentHint: false },
    async handler(args, ctx) {
      const target = await ctx.dir.resolveTarget(args.tab, ctx.strict);
      const t = await ctx.dir.requireTab(target.tabId);
      const { body, payer, expenseDate, currency } = await prepareExpense(t, args, ctx);
      const names = nameIndex(t, ctx.userId);
      if (!args.allowDuplicate) {
        const dups = await possibleDuplicatesOf(
          t.id,
          { amount: args.amount, currency, description: body.description, date: expenseDate },
          t.currency,
          ctx,
        );
        if (dups.length > 0) {
          throw new ToolError(
            `Not added: this looks like it may already be logged. Ask the user; if it's a separate expense, call again with allowDuplicate: true.`,
            { possibleDuplicates: dups.slice(0, 5).map((e) => duplicateBrief(e, names, t.currency, ctx)) },
          );
        }
      }
      const created = unwrap(await expenseService.create(body, ctx.userId));
      return {
        summary: `Added "${created.description}" (${roundMoney(created.amount, created.currency)} ${created.currency}) to ${target.kind === "friend" ? `your tab with ${target.name}` : `"${t.name}"`}, paid by ${payer.userId === ctx.userId ? "you" : participantName(payer)}.`,
        data: {
          expenseId: created.expenseId,
          tabId: created.tabId,
          ...money(created.amount, created.currency),
          ...(created.expenseCurrency !== created.currency
            ? { originalAmount: created.originalAmount, expenseCurrency: created.expenseCurrency, fxRateDate: created.fxRateDate }
            : {}),
          date: isoDate(expenseDate, ctx.timeZone),
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
    name: "create_expenses",
    title: "Add several expenses",
    description:
      "Adds up to 50 expenses to one tab in a single call. Every line is checked first and nothing is written unless all of them are valid (all-or-nothing). " +
      "Each other person the batch involves (as payer or in a split) gets one notification for the whole batch instead of one per expense. " +
      "Before writing, show the user one summary of every line (description, amount, payer, split) and get a single confirmation; call with dryRun: true to get that summary from Tab without writing. " +
      "Each line takes the same fields as create_expense (description, amount, currency, date, paidBy, splitType, participants, splits, splitLike). " +
      "Lines that look like an existing expense (or another line in the batch) block the write and come back as possibleDuplicates; pass allowDuplicates: true only after the user confirms. " +
      'Example: {tab: "Pauri", expenses: [{description: "Blinkit", amount: 640}, {description: "Milk", amount: 120, date: "2026-11-25"}]}.',
    scope: "write",
    input: z.object({
      tab: tabRef,
      expenses: z.array(expenseLine).min(1).max(50),
      dryRun: z.boolean().optional().describe("Validate and return the summary without writing anything."),
      allowDuplicates: z.boolean().optional().describe("Write even if some lines look like duplicates. Only after the user confirms."),
    }),
    annotations: { destructiveHint: false, idempotentHint: false },
    async handler(args, ctx) {
      const target = await ctx.dir.resolveTarget(args.tab, ctx.strict);
      const t = await ctx.dir.requireTab(target.tabId);
      const names = nameIndex(t, ctx.userId);

      const prepared: PreparedExpense[] = [];
      const errors: string[] = [];
      for (const [i, line] of args.expenses.entries()) {
        try {
          prepared.push(await prepareExpense(t, line, ctx));
        } catch (e) {
          if (!(e instanceof ToolError)) throw e;
          errors.push(`Line ${i + 1} (${line.description}): ${e.message}`);
        }
      }
      if (errors.length > 0) {
        throw new ToolError(`Nothing was added. Fix these lines and try again:\n${errors.join("\n")}`);
      }

      const preview = prepared.map((p, i) => ({
        line: i + 1,
        description: p.body.description,
        amount: p.body.amount,
        currency: p.currency,
        date: isoDate(p.expenseDate, ctx.timeZone),
        paidBy: p.payer.userId === ctx.userId ? "You" : participantName(p.payer),
        splitType: p.body.splitType,
        splitWith: (p.body.participantIds ?? t.participants.map((x) => x.id)).map((id) => names.get(id) ?? "Unknown"),
      }));

      if (!args.allowDuplicates) {
        const dupes: Array<{ line: number; matches: unknown[] }> = [];
        for (const [i, p] of prepared.entries()) {
          const existing = await possibleDuplicatesOf(
            t.id,
            { amount: p.body.amount, currency: p.currency, description: p.body.description, date: p.expenseDate },
            t.currency,
            ctx,
          );
          const inBatch = prepared
            .map((q, j) => ({ q, j }))
            .filter(
              ({ q, j }) =>
                j < i &&
                q.currency === p.currency &&
                similarAmounts(q.body.amount, p.body.amount) &&
                similarDescriptions(q.body.description, p.body.description) &&
                Math.abs(q.expenseDate.getTime() - p.expenseDate.getTime()) <= 3 * 24 * 60 * 60 * 1000,
            )
            .map(({ j }) => ({ sameAsLine: j + 1 }));
          const matches = [...existing.slice(0, 3).map((e) => duplicateBrief(e, names, t.currency, ctx)), ...inBatch];
          if (matches.length > 0) dupes.push({ line: i + 1, matches });
        }
        if (dupes.length > 0) {
          throw new ToolError(
            "Nothing was added: some lines look like expenses that are already logged (or repeat another line). Ask the user; if they're all separate, call again with allowDuplicates: true.",
            { possibleDuplicates: dupes },
          );
        }
      }

      const where = target.kind === "friend" ? `your tab with ${target.name}` : `"${t.name}"`;
      const totals = new Map<string, number>();
      for (const p of prepared) totals.set(p.currency, (totals.get(p.currency) ?? 0) + p.body.amount);
      const totalText = [...totals].map(([c, a]) => `${roundMoney(a, c)} ${c}`).join(" + ");

      if (args.dryRun) {
        return {
          summary: `Dry run: ${prepared.length} expenses (${totalText}) are ready to add to ${where}. Nothing was written; confirm with the user, then call again without dryRun.`,
          data: { tabId: t.id, expenses: preview },
        };
      }

      const result = unwrap(
        await expenseService.createBulk(
          t.id,
          prepared.map((p) => p.body as unknown as Record<string, unknown>),
          ctx.userId,
          { atomic: true },
        ),
      );
      return {
        summary: `Added ${result.imported} expenses (${totalText}) to ${where}.`,
        data: {
          tabId: t.id,
          expenses: preview.map((p, i) => ({ expenseId: result.expenseIds[i] ?? null, ...p })),
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
      const existing = await loadExpense(target.tabId, args.expenseId, ctx);
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
