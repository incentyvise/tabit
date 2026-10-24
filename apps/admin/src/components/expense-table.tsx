import { Fragment, useState } from "react";
import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { ChevronDown, ChevronRight, Repeat } from "lucide-react";
import { orpc } from "@/lib/orpc";
import { fmtDate, fmtDateTime, fmtMoney } from "@/lib/format";
import { cn } from "@/lib/utils";
import { JsonView, Mono, Pill } from "@/components/common";
import { Skeleton } from "@/components/ui/skeleton";

export type ExpenseRow = {
  id: string;
  tabId: string;
  tabName: string;
  isDirect: boolean;
  description: string;
  amount: number;
  originalAmount: number;
  currency: string;
  tabCurrency: string;
  splitType: string;
  expenseDate: Date | string;
  createdAt: Date | string;
  deletedAt: Date | string | null;
  recurringRuleId: string | null;
  paidByName: string | null;
};

export function ExpenseTable({
  rows,
  showTab = true,
  loading,
}: {
  rows: ExpenseRow[] | undefined;
  showTab?: boolean;
  loading?: boolean;
}) {
  const [open, setOpen] = useState<string | null>(null);
  const cols = showTab ? 7 : 6;
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted-foreground">
            <th className="w-6 px-3 py-2" />
            <th className="px-3 py-2 font-medium">Expense</th>
            {showTab && <th className="px-3 py-2 font-medium">Tab</th>}
            <th className="px-3 py-2 font-medium">Paid by</th>
            <th className="px-3 py-2 text-right font-medium">Amount</th>
            <th className="px-3 py-2 font-medium">Date</th>
            <th className="px-3 py-2 font-medium">Split</th>
          </tr>
        </thead>
        <tbody>
          {loading &&
            Array.from({ length: 6 }).map((_, i) => (
              <tr key={i} className="border-b border-border/60">
                <td colSpan={cols} className="px-3 py-2.5">
                  <Skeleton className="h-4 w-full" />
                </td>
              </tr>
            ))}
          {!loading &&
            rows?.map((e) => {
              const isOpen = open === e.id;
              const foreign = e.currency !== e.tabCurrency;
              return (
                <Fragment key={e.id}>
                  <tr
                    onClick={() => setOpen(isOpen ? null : e.id)}
                    className={cn(
                      "cursor-pointer border-b border-border/60 hover:bg-accent/60",
                      e.deletedAt && "opacity-60",
                    )}
                  >
                    <td className="px-3 py-2.5 text-muted-foreground">
                      {isOpen ? <ChevronDown className="size-4" /> : <ChevronRight className="size-4" />}
                    </td>
                    <td className="px-3 py-2.5">
                      <div className="flex items-center gap-2">
                        <span className={cn("font-medium", e.deletedAt && "line-through")}>{e.description}</span>
                        {e.recurringRuleId && <Repeat className="size-3.5 text-muted-foreground" />}
                        {e.deletedAt && <Pill tone="negative">Deleted</Pill>}
                      </div>
                    </td>
                    {showTab && (
                      <td className="px-3 py-2.5">
                        <Link
                          to="/tabs/$tabId"
                          params={{ tabId: e.tabId }}
                          onClick={(ev) => ev.stopPropagation()}
                          className="hover:underline"
                        >
                          {e.isDirect ? "Direct tab" : e.tabName}
                        </Link>
                      </td>
                    )}
                    <td className="px-3 py-2.5">{e.paidByName ?? "—"}</td>
                    <td className="whitespace-nowrap px-3 py-2.5 text-right tabular-nums">
                      {fmtMoney(e.originalAmount, e.currency)}
                      {foreign && (
                        <div className="text-xs text-muted-foreground">{fmtMoney(e.amount, e.tabCurrency)}</div>
                      )}
                    </td>
                    <td className="whitespace-nowrap px-3 py-2.5">{fmtDate(e.expenseDate)}</td>
                    <td className="px-3 py-2.5">
                      <Pill>{e.splitType}</Pill>
                    </td>
                  </tr>
                  {isOpen && (
                    <tr className="border-b border-border/60 bg-muted/30">
                      <td colSpan={cols} className="px-3 py-3">
                        <ExpenseDetail expenseId={e.id} />
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
        </tbody>
      </table>
      {!loading && rows?.length === 0 && (
        <div className="py-10 text-center text-sm text-muted-foreground">No expenses.</div>
      )}
    </div>
  );
}

function ExpenseDetail({ expenseId }: { expenseId: string }) {
  const query = useQuery(orpc.expenses.get.queryOptions({ input: { expenseId } }));
  if (!query.data) return <Skeleton className="h-20 w-full" />;
  const { expense, splits, audit, reactions } = query.data;
  return (
    <div className="grid gap-4 md:grid-cols-3">
      <div>
        <div className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">Splits</div>
        <ul className="space-y-1 text-sm">
          {splits.map((s) => (
            <li key={s.id} className="flex justify-between gap-2">
              <span>
                {s.name ?? "Unknown"}
                {s.weight && <span className="text-xs text-muted-foreground"> ({Number(s.weight)})</span>}
              </span>
              <span className="tabular-nums">{fmtMoney(s.amount, expense.tabCurrency)}</span>
            </li>
          ))}
        </ul>
        {reactions.length > 0 && (
          <div className="mt-3 text-sm">
            {reactions.map((r, i) => (
              <span key={i} title={r.name ?? ""} className="mr-1">
                {r.emoji}
              </span>
            ))}
          </div>
        )}
      </div>
      <div className="md:col-span-2">
        <div className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">History</div>
        <ul className="space-y-2 text-sm">
          {audit.map((a) => (
            <li key={a.id}>
              <div className="flex items-center gap-2">
                <Pill tone={a.action === "delete" ? "negative" : a.action === "create" ? "positive" : "warning"}>
                  {a.action}
                </Pill>
                <span>{a.userName ?? "Unknown"}</span>
                <span className="text-xs text-muted-foreground">{fmtDateTime(a.at)}</span>
              </div>
              {a.action === "update" && <div className="mt-1"><JsonView value={a.changes} /></div>}
            </li>
          ))}
        </ul>
        <div className="mt-3 text-xs text-muted-foreground">
          id <Mono>{expense.id}</Mono> · created {fmtDateTime(expense.createdAt)}
          {expense.deletedAt && <> · deleted {fmtDateTime(expense.deletedAt)}</>}
        </div>
      </div>
    </div>
  );
}
