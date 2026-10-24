import { useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { orpc } from "@/lib/orpc";
import { fmtDateTime, fmtNumber, fmtPercent } from "@/lib/format";
import {
  DataTable,
  ErrorState,
  LoadingBlock,
  Mono,
  PageHeader,
  Pill,
  Section,
  Segmented,
  StatCard,
  StatGrid,
} from "@/components/common";
import { BarList, DailyStackedBarChart } from "@/components/charts";

export const Route = createFileRoute("/_admin/ai")({
  component: AiPage,
});

const OUTCOME_TONE = {
  success: "positive",
  low_confidence: "warning",
  parse_error: "warning",
  error: "negative",
} as const;

function AiPage() {
  const [days, setDays] = useState<"7" | "30" | "90">("30");
  const query = useQuery(orpc.ai.queryOptions({ input: { days: Number(days) } }));

  if (query.isError) return <ErrorState error={query.error} />;
  if (!query.data) return <LoadingBlock rows={4} />;

  const { totals: t, daily, topUsers, recent } = query.data;

  return (
    <>
      <PageHeader
        title="AI usage"
        description="Voice / text expense entry (Gemini). Recorded per call since this console shipped."
        actions={
          <Segmented
            value={days}
            onChange={setDays}
            options={[
              { value: "7", label: "7d" },
              { value: "30", label: "30d" },
              { value: "90", label: "90d" },
            ]}
          />
        }
      />
      <div className="space-y-6">
        <StatGrid>
          <StatCard label="Calls" value={fmtNumber(t.calls)} hint={`${t.users} users`} />
          <StatCard label="Success rate" value={fmtPercent(t.success, t.calls)} tone="positive" hint={`${t.success} created expenses`} />
          <StatCard label="Ambiguous" value={fmtNumber(t.lowConfidence + t.parseError)} tone="warning" hint="Low confidence or unparseable" />
          <StatCard label="Errors" value={fmtNumber(t.error)} tone={t.error ? "negative" : "default"} />
          <StatCard
            label="Latency"
            value={t.p50LatencyMs == null ? "—" : `${Math.round(t.p50LatencyMs)}ms`}
            hint={t.p95LatencyMs == null ? undefined : `p95 ${Math.round(t.p95LatencyMs)}ms`}
          />
          <StatCard
            label="Tokens"
            value={fmtNumber(t.inputTokens + t.outputTokens)}
            hint={`${fmtNumber(t.inputTokens)} in · ${fmtNumber(t.outputTokens)} out`}
          />
        </StatGrid>

        <div className="grid gap-6 lg:grid-cols-3">
          <Section title="Calls per day" className="lg:col-span-2">
            <DailyStackedBarChart
              data={daily}
              series={[
                { key: "success", label: "Success", color: "var(--chart-3)" },
                { key: "failed", label: "Not created", color: "var(--chart-4)" },
              ]}
            />
          </Section>
          <Section title="Top users">
            <BarList
              items={topUsers.map((u) => ({
                label: u.name || u.email,
                value: u.calls,
                hint: fmtPercent(u.success, u.calls),
              }))}
            />
          </Section>
        </div>

        <Section title="Recent calls" bodyClassName="p-0">
          <DataTable
            rows={recent}
            rowKey={(r) => r.id}
            empty="No AI calls recorded yet."
            columns={[
              { key: "at", header: "When", cell: (r) => fmtDateTime(r.createdAt), className: "whitespace-nowrap" },
              {
                key: "user",
                header: "User",
                cell: (r) => (
                  <Link to="/users/$userId" params={{ userId: r.userId }} className="hover:underline">
                    <Mono>{r.userId.slice(0, 10)}</Mono>
                  </Link>
                ),
              },
              {
                key: "outcome",
                header: "Outcome",
                cell: (r) => (
                  <Pill tone={OUTCOME_TONE[r.outcome as keyof typeof OUTCOME_TONE] ?? "neutral"}>{r.outcome}</Pill>
                ),
              },
              {
                key: "conf",
                header: "Confidence",
                cell: (r) => (r.confidence == null ? "—" : Number(r.confidence).toFixed(2)),
                className: "tabular-nums",
              },
              { key: "latency", header: "Latency", cell: (r) => `${r.latencyMs}ms`, className: "tabular-nums" },
              {
                key: "tokens",
                header: "Tokens",
                cell: (r) => (r.inputTokens == null ? "—" : `${r.inputTokens} / ${r.outputTokens ?? 0}`),
                className: "tabular-nums whitespace-nowrap",
              },
              { key: "chars", header: "Input", cell: (r) => `${r.inputChars} chars`, className: "whitespace-nowrap" },
              {
                key: "note",
                header: "Note",
                cell: (r) => <span className="text-xs text-muted-foreground">{r.errorMessage ?? "—"}</span>,
              },
            ]}
          />
        </Section>
      </div>
    </>
  );
}
