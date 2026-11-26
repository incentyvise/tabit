import { z } from "zod";
import { settlementService, tabService } from "services";
import { CURRENCY_CODES, simplifyDebts } from "shared";
import { ToolError, unwrap } from "../context.js";
import { defineTool } from "../tool.js";
import { parseDateArg, roundMoney } from "../format.js";
import { participantName, resolveParticipant } from "../resolve.js";

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

function parseDate(value: string | undefined): Date | undefined {
  try {
    return parseDateArg(value, "date");
  } catch (e) {
    throw new ToolError((e as Error).message);
  }
}

function checkCurrency(c: string | undefined): string | undefined {
  if (!c) return undefined;
  const up = c.toUpperCase();
  if (!(CURRENCY_CODES as readonly string[]).includes(up)) throw new ToolError(`Unsupported currency code ${up}`);
  return up;
}

export const settlementTools = [
  defineTool({
    name: "record_settlement",
    title: "Record a payment",
    description:
      "Records that someone paid someone back (a settle-up) in a tab. In a 1:1 friend tab, `from`/`to` default to the two of you based on who owes whom. " +
      "Omit `amount` to settle the full outstanding amount between the two people. Confirm the amount with the user before recording.",
    scope: "write",
    input: z.object({
      tab: tabRef,
      from: personRef.optional().describe("Who paid. Default: whoever owes in a 1:1 tab; required in group tabs unless it's you."),
      to: personRef.optional().describe("Who received the money."),
      amount: z.number().positive().optional().describe("Amount paid, in `currency`. Omit to settle the full suggested amount."),
      currency: z.string().length(3).optional().describe("Defaults to the tab's currency."),
      date: z.string().optional().describe("YYYY-MM-DD. Defaults to today."),
    }),
    annotations: { destructiveHint: false, idempotentHint: false },
    async handler(args, ctx) {
      const target = await ctx.dir.resolveTarget(args.tab, ctx.strict);
      const t = await ctx.dir.requireTab(target.tabId);
      const me = resolveParticipant(t, "me", ctx.userId, ctx.strict);
      const balances = unwrap(await tabService.getBalancesForTab(target.tabId, ctx.userId));
      const { transfers } = simplifyDebts(
        balances.map((b) => ({ participantId: b.participantId, amount: b.amount })),
        { currency: t.currency },
      );

      let from = args.from ? resolveParticipant(t, args.from, ctx.userId, ctx.strict) : undefined;
      let to = args.to ? resolveParticipant(t, args.to, ctx.userId, ctx.strict) : undefined;

      if (!from || !to) {
        if (target.kind === "friend") {
          const other = t.participants.find((p) => p.id !== me.id && !!p.userId);
          if (!other) throw new ToolError("Could not find your friend in this tab");
          const myNet = balances.find((b) => b.participantId === me.id)?.amount ?? 0;
          if (!from && !to) {
            if (Math.abs(myNet) < 0.005) {
              throw new ToolError(
                args.amount === undefined
                  ? "You and your friend are already settled up."
                  : "You're settled up, so the direction isn't obvious. Ask the user who paid whom and pass `from`/`to`.",
              );
            }
            [from, to] = myNet < 0 ? [me, other] : [other, me];
          } else if (!from) {
            from = to!.id === me.id ? other : me;
          } else {
            to = from.id === me.id ? other : me;
          }
        } else if (!from && to) {
          from = me;
        } else if (from && !to) {
          const suggestion = transfers.filter((tr) => tr.fromParticipantId === from!.id);
          if (suggestion.length !== 1) {
            throw new ToolError("Say who received the money (`to`).");
          }
          to = t.participants.find((p) => p.id === suggestion[0]!.toParticipantId);
        } else {
          throw new ToolError("In a group tab, say who paid (`from`) and who received it (`to`).");
        }
      }
      if (!from || !to) throw new ToolError("Could not work out who paid whom.");
      if (from.id === to.id) throw new ToolError("Payer and receiver must be different people.");

      const currency = checkCurrency(args.currency) ?? t.currency;
      let amount = args.amount;
      if (amount === undefined) {
        if (currency !== t.currency) {
          throw new ToolError("Pass `amount` when paying in a currency other than the tab's.");
        }
        const tr = transfers.find((x) => x.fromParticipantId === from!.id && x.toParticipantId === to!.id);
        if (!tr) {
          throw new ToolError(
            `${participantName(from)} doesn't owe ${participantName(to)} anything in the suggested settle-up. Pass an explicit amount if this is right.`,
          );
        }
        amount = tr.amount;
      }

      const date = parseDate(args.date);
      unwrap(
        await settlementService.record(
          target.tabId,
          null,
          null,
          amount,
          ctx.userId,
          currency,
          currency !== t.currency ? amount : null,
          date ?? null,
          from.id,
          to.id,
        ),
      );
      const fromName = from.id === me.id ? "You" : participantName(from);
      const toName = to.id === me.id ? "you" : participantName(to);
      return {
        summary: `Recorded: ${fromName} paid ${toName} ${roundMoney(amount, currency)} ${currency}.`,
        data: { tabId: target.tabId, from: fromName, to: toName, amount: roundMoney(amount, currency), currency },
      };
    },
  }),

  defineTool({
    name: "update_settlement",
    title: "Edit a payment",
    description: "Changes the amount, date, currency or people on a recorded payment. Pass only what changes.",
    scope: "write",
    input: z.object({
      tab: tabRef,
      settlementId: z.string().min(1),
      from: personRef.optional(),
      to: personRef.optional(),
      amount: z.number().positive().optional(),
      currency: z.string().length(3).optional(),
      date: z.string().optional().describe("YYYY-MM-DD."),
    }),
    annotations: { destructiveHint: false, idempotentHint: true },
    async handler(args, ctx) {
      const target = await ctx.dir.resolveTarget(args.tab, ctx.strict);
      const t = await ctx.dir.requireTab(target.tabId);
      const s = unwrap(await settlementService.getById(target.tabId, args.settlementId, ctx.userId)) as unknown as {
        fromParticipantId: string | null;
        toParticipantId: string | null;
        fromUserId: string | null;
        toUserId: string | null;
        amount: string | number;
        currency: string | null;
        originalAmount: string | number | null;
        settlementDate: Date;
      };
      const from = args.from ? resolveParticipant(t, args.from, ctx.userId, ctx.strict).id : s.fromParticipantId;
      const to = args.to ? resolveParticipant(t, args.to, ctx.userId, ctx.strict).id : s.toParticipantId;
      const currency = checkCurrency(args.currency) ?? s.currency ?? t.currency;
      const amount =
        args.amount ??
        (s.currency && s.currency !== t.currency && s.originalAmount != null
          ? Number(s.originalAmount)
          : Number(s.amount));
      unwrap(
        await settlementService.update(
          target.tabId,
          args.settlementId,
          from ? null : s.fromUserId,
          to ? null : s.toUserId,
          amount,
          ctx.userId,
          currency,
          currency !== t.currency ? amount : null,
          parseDate(args.date) ?? s.settlementDate,
          from,
          to,
        ),
      );
      return { summary: "Payment updated.", data: { settlementId: args.settlementId, tabId: target.tabId } };
    },
  }),

  defineTool({
    name: "delete_settlement",
    title: "Delete a payment",
    description: "Deletes a recorded payment. This cannot be undone; confirm with the user first.",
    scope: "write",
    input: z.object({ tab: tabRef, settlementId: z.string().min(1) }),
    annotations: { destructiveHint: true, idempotentHint: true },
    async handler(args, ctx) {
      const target = await ctx.dir.resolveTarget(args.tab, ctx.strict);
      unwrap(await settlementService.delete(target.tabId, args.settlementId, ctx.userId));
      return { summary: "Payment deleted.", data: { settlementId: args.settlementId, tabId: target.tabId } };
    },
  }),
];
