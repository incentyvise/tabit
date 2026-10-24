import { useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { orpc } from "@/lib/orpc";
import { displayName, fmtAgo, fmtMoney, fmtNumber, fmtPercent } from "@/lib/format";
import {
  ErrorState,
  LoadingBlock,
  PageHeader,
  Section,
  Segmented,
  StatCard,
  StatGrid,
} from "@/components/common";
import { BarList, DailyAreaChart } from "@/components/charts";

export const Route = createFileRoute("/_admin/")({
  component: OverviewPage,
});

const RANGES = [
  { value: "30", label: "30d" },
  { value: "90", label: "90d" },
  { value: "180", label: "180d" },
] as const;

function OverviewPage() {
  const [range, setRange] = useState<"30" | "90" | "180">("30");
  const overview = useQuery(orpc.overview.queryOptions());
  const series = useQuery(orpc.timeseries.queryOptions({ input: { days: Number(range) } }));

  if (overview.isError) return <ErrorState error={overview.error} />;
  if (!overview.data) return <LoadingBlock rows={4} />;

  const { counts: c, funnel: f, recentSignups, volumeByCurrency } = overview.data;

  return (
    <>
      <PageHeader title="Overview" description="How Tab is doing right now." />

      <div className="space-y-6">
        <StatGrid>
          <StatCard label="Users" value={fmtNumber(c.users)} hint={`+${c.newUsers7d} this week`} />
          <StatCard label="New today" value={fmtNumber(c.newUsers1d)} hint={`${c.newUsers30d} in 30d`} />
          <StatCard
            label="Active 7d"
            value={fmtNumber(c.activeUsers7d)}
            hint={`${fmtPercent(c.activeUsers7d, c.users)} of users · ${c.activeUsers30d} in 30d`}
          />
          <StatCard label="Seen 7d" value={fmtNumber(c.seenUsers7d)} hint="Session refreshed" />
          <StatCard
            label="Tabs"
            value={fmtNumber(c.tabs)}
            hint={`${c.groupTabs} groups · +${c.newTabs7d} this week`}
          />
          <StatCard label="Expenses" value={fmtNumber(c.expenses)} hint={`+${c.expenses7d} this week`} />
          <StatCard label="Settlements" value={fmtNumber(c.settlements)} />
          <StatCard label="Recurring rules" value={fmtNumber(c.activeRecurringRules)} hint="Active" />
          <StatCard
            label="Push"
            value={fmtNumber(c.pushUsers)}
            hint={`${c.pushSubscriptions} subscriptions`}
          />
          <StatCard label="AI calls 7d" value={fmtNumber(c.aiCalls7d)} />
          <StatCard
            label="Banned"
            value={fmtNumber(c.bannedUsers)}
            tone={c.bannedUsers ? "warning" : "default"}
          />
        </StatGrid>

        <Section
          title="Growth"
          actions={<Segmented value={range} options={[...RANGES]} onChange={setRange} />}
        >
          {series.data ? (
            <div className="grid gap-6 lg:grid-cols-2">
              <div>
                <div className="mb-2 text-xs font-medium text-muted-foreground">Signups & new tabs</div>
                <DailyAreaChart
                  data={series.data}
                  series={[
                    { key: "signups", label: "Signups", color: "var(--chart-1)" },
                    { key: "tabs", label: "New tabs", color: "var(--chart-2)" },
                  ]}
                />
              </div>
              <div>
                <div className="mb-2 text-xs font-medium text-muted-foreground">
                  Activity (expenses, settlements, active users)
                </div>
                <DailyAreaChart
                  data={series.data}
                  series={[
                    { key: "expenses", label: "Expenses", color: "var(--chart-3)" },
                    { key: "settlements", label: "Settlements", color: "var(--chart-5)" },
                    { key: "activeUsers", label: "Active users", color: "var(--chart-2)" },
                  ]}
                />
              </div>
            </div>
          ) : (
            <LoadingBlock rows={1} />
          )}
        </Section>

        <div className="grid gap-6 lg:grid-cols-3">
          <Section title="Activation funnel" description="All-time, per user">
            <BarList
              max={f.signedUp}
              items={[
                { label: "Signed up", value: f.signedUp },
                { label: "Set username", value: f.profileComplete, hint: fmtPercent(f.profileComplete, f.signedUp) },
                { label: "Joined a tab", value: f.joinedTab, hint: fmtPercent(f.joinedTab, f.signedUp) },
                { label: "Added an expense", value: f.firstExpense, hint: fmtPercent(f.firstExpense, f.signedUp) },
                { label: "5+ expenses", value: f.fiveExpenses, hint: fmtPercent(f.fiveExpenses, f.signedUp) },
                { label: "Recorded a settlement", value: f.settledUp, hint: fmtPercent(f.settledUp, f.signedUp) },
              ]}
            />
          </Section>

          <Section title="Volume by currency" description="Live expenses, entered amounts">
            <BarList
              items={volumeByCurrency.map((v) => ({
                label: `${v.currency} · ${v.count.toLocaleString()} expenses`,
                value: v.total,
              }))}
              format={(n) => fmtMoney(n, undefined).replace(/^\D+/, "")}
            />
          </Section>

          <Section title="Recent signups" bodyClassName="p-0">
            <ul className="divide-y divide-border">
              {recentSignups.map((u) => (
                <li key={u.id}>
                  <Link
                    to="/users/$userId"
                    params={{ userId: u.id }}
                    className="flex items-center justify-between gap-2 px-4 py-2.5 text-sm hover:bg-accent/60"
                  >
                    <div className="min-w-0">
                      <div className="truncate font-medium">{displayName(u)}</div>
                      <div className="truncate text-xs text-muted-foreground">{u.email}</div>
                    </div>
                    <span className="shrink-0 text-xs text-muted-foreground">{fmtAgo(u.createdAt)}</span>
                  </Link>
                </li>
              ))}
            </ul>
          </Section>
        </div>
      </div>
    </>
  );
}
