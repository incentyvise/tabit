import { Link } from "@tanstack/react-router";
import { fmtAgo, fmtMoney } from "@/lib/format";
import { DataTable, Pill } from "@/components/common";

export type RecurringRuleRow = {
  id: string;
  tabId: string;
  tabName: string;
  ownerName: string | null;
  ownerUserId: string;
  status: string;
  schedule: unknown;
  template: { description?: string; amount?: number; currency?: string } & Record<string, unknown>;
  startsOn: string;
  endsOn: string | null;
  maxCount: number | null;
  postedCount: number;
  nextDueKey: string;
  lastPostedAt: Date | string | null;
};

const STATUS_TONE: Record<string, "positive" | "warning" | "negative" | "neutral"> = {
  active: "positive",
  paused_user: "neutral",
  paused_needs_fix: "negative",
};

const WEEKDAYS = ["", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

/** Mirrors recurringScheduleSchema in packages/models. */
function describeSchedule(schedule: unknown): string {
  if (!schedule || typeof schedule !== "object") return "—";
  const s = schedule as { type?: string; intervalDays?: number; dayOfMonth?: number; weekdays?: number[] };
  if (s.type === "interval_days") return `Every ${s.intervalDays} days`;
  if (s.type === "monthly_nth") return `Monthly on day ${s.dayOfMonth}`;
  if (s.type === "weekly") return `Weekly on ${(s.weekdays ?? []).map((d) => WEEKDAYS[d]).join(", ")}`;
  return "Custom";
}

export function RecurringTable({ rows, showTab = true }: { rows: RecurringRuleRow[]; showTab?: boolean }) {
  return (
    <DataTable
      rows={rows}
      rowKey={(r) => r.id}
      empty="No recurring rules."
      columns={[
        {
          key: "rule",
          header: "Rule",
          cell: (r) => (
            <div>
              <div className="font-medium">{r.template.description ?? "Untitled"}</div>
              <div className="text-xs text-muted-foreground">
                {describeSchedule(r.schedule)} · by{" "}
                <Link to="/users/$userId" params={{ userId: r.ownerUserId }} className="hover:underline">
                  {r.ownerName ?? "owner"}
                </Link>
              </div>
            </div>
          ),
        },
        ...(showTab
          ? [
              {
                key: "tab",
                header: "Tab",
                cell: (r: RecurringRuleRow) => (
                  <Link to="/tabs/$tabId" params={{ tabId: r.tabId }} className="hover:underline">
                    {r.tabName || "Direct tab"}
                  </Link>
                ),
              },
            ]
          : []),
        {
          key: "amount",
          header: "Amount",
          className: "text-right tabular-nums whitespace-nowrap",
          cell: (r) => (r.template.amount != null ? fmtMoney(r.template.amount, r.template.currency) : "—"),
        },
        {
          key: "status",
          header: "Status",
          cell: (r) => <Pill tone={STATUS_TONE[r.status] ?? "neutral"}>{r.status.replace(/_/g, " ")}</Pill>,
        },
        {
          key: "posted",
          header: "Posted",
          className: "tabular-nums whitespace-nowrap",
          cell: (r) => `${r.postedCount}${r.maxCount ? ` / ${r.maxCount}` : ""}`,
        },
        { key: "next", header: "Next due", cell: (r) => r.nextDueKey, className: "whitespace-nowrap" },
        {
          key: "last",
          header: "Last posted",
          cell: (r) => <span className="text-muted-foreground">{fmtAgo(r.lastPostedAt)}</span>,
          className: "whitespace-nowrap",
        },
      ]}
    />
  );
}
