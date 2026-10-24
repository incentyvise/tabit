import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { differenceInHours } from "date-fns";
import { orpc } from "@/lib/orpc";
import { fmtAgo, fmtDateTime } from "@/lib/format";
import {
  DataTable,
  ErrorState,
  LoadingBlock,
  PageHeader,
  Pill,
  Section,
  StatCard,
  StatGrid,
} from "@/components/common";
import { RecurringTable } from "@/components/recurring-table";

export const Route = createFileRoute("/_admin/recurring")({
  component: RecurringPage,
});

function RecurringPage() {
  const query = useQuery(orpc.recurring.queryOptions());
  if (query.isError) return <ErrorState error={query.error} />;
  if (!query.data) return <LoadingBlock rows={4} />;

  const { byStatus, needsFix, overdue, recentOccurrences, fxSnapshots } = query.data;
  const count = (s: string) => byStatus.find((b) => b.status === s)?.count ?? 0;
  const latestFx = fxSnapshots[0];
  const fxAgeHours = latestFx ? differenceInHours(new Date(), new Date(latestFx.fetchedAt)) : null;
  const lastPost = recentOccurrences[0];

  return (
    <>
      <PageHeader
        title="Recurring & FX"
        description="Recurring rules run every 15 minutes; FX rates warm daily at 16:00."
      />
      <div className="space-y-6">
        <StatGrid>
          <StatCard label="Active rules" value={count("active")} tone="positive" />
          <StatCard label="Paused by user" value={count("paused_user")} />
          <StatCard label="Needs fix" value={count("paused_needs_fix")} tone={needsFix.length ? "negative" : "default"} />
          <StatCard label="Overdue" value={overdue.length} tone={overdue.length ? "warning" : "default"} hint="Active, due before yesterday" />
          <StatCard label="Last posted" value={lastPost ? fmtAgo(lastPost.createdAt) : "—"} />
          <StatCard
            label="FX freshness"
            value={fxAgeHours == null ? "—" : `${fxAgeHours}h`}
            tone={fxAgeHours == null || fxAgeHours > 30 ? "warning" : "positive"}
            hint={latestFx ? `${latestFx.base} @ ${latestFx.rateDate}` : "No snapshots"}
          />
        </StatGrid>

        <Section title="Needs fix" description="Paused automatically — usually a member left or a payer is gone" bodyClassName="p-0">
          <RecurringTable rows={needsFix} />
        </Section>

        <Section title="Overdue" description="Active rules whose next due date has passed — the tick may be failing" bodyClassName="p-0">
          <RecurringTable rows={overdue} />
        </Section>

        <div className="grid gap-6 lg:grid-cols-2">
          <Section title="Recent occurrences" bodyClassName="p-0">
            <DataTable
              rows={recentOccurrences}
              rowKey={(o) => o.id}
              empty="Nothing posted yet."
              columns={[
                {
                  key: "desc",
                  header: "Expense",
                  cell: (o) => (
                    <div>
                      <div className="font-medium">{o.description ?? "—"}</div>
                      <Link to="/tabs/$tabId" params={{ tabId: o.tabId }} className="text-xs text-muted-foreground hover:underline">
                        {o.tabName || "Direct tab"}
                      </Link>
                    </div>
                  ),
                },
                { key: "key", header: "Occurrence", cell: (o) => o.occurrenceKey, className: "whitespace-nowrap" },
                {
                  key: "expense",
                  header: "",
                  cell: (o) => (o.expenseId ? null : <Pill tone="warning">expense removed</Pill>),
                },
                { key: "at", header: "Posted", cell: (o) => fmtDateTime(o.createdAt), className: "whitespace-nowrap" },
              ]}
            />
          </Section>

          <Section title="FX snapshots" bodyClassName="p-0">
            <DataTable
              rows={fxSnapshots}
              rowKey={(f) => f.id}
              empty="No FX snapshots."
              columns={[
                { key: "date", header: "Rate date", cell: (f) => f.rateDate },
                { key: "base", header: "Base", cell: (f) => <Pill>{f.base}</Pill> },
                { key: "count", header: "Currencies", cell: (f) => f.currencyCount, className: "tabular-nums" },
                { key: "fetched", header: "Fetched", cell: (f) => fmtDateTime(f.fetchedAt), className: "whitespace-nowrap" },
              ]}
            />
          </Section>
        </div>
      </div>
    </>
  );
}
