import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { RefreshCw, RotateCcw } from "lucide-react";
import { toast } from "sonner";
import { adminRpc, orpc } from "@/lib/orpc";
import { describeUserAgent, fmtAgo, fmtDateTime, fmtNumber } from "@/lib/format";
import {
  DataTable,
  ErrorState,
  LoadingBlock,
  Mono,
  PageHeader,
  Pill,
  Section,
  StatCard,
  StatGrid,
} from "@/components/common";
import { BarList } from "@/components/charts";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/_admin/queue")({
  component: QueuePage,
});

function QueuePage() {
  const queryClient = useQueryClient();
  const query = useQuery({ ...orpc.queue.overview.queryOptions(), refetchInterval: 15_000 });
  if (query.isError) return <ErrorState error={query.error} />;
  if (!query.data) return <LoadingBlock rows={4} />;

  const { isPaused, queueError, failed, push } = query.data;
  const counts = query.data.counts ?? {};
  const refresh = () => queryClient.invalidateQueries({ queryKey: orpc.queue.key() });

  return (
    <>
      <PageHeader
        title="Queue & push"
        description="BullMQ notifications queue (socket + web push delivery). Auto-refreshes every 15s."
        actions={
          <Button variant="outline" size="sm" onClick={() => void refresh()}>
            <RefreshCw /> Refresh
          </Button>
        }
      />
      <div className="space-y-6">
        {queueError && <ErrorState error={new Error(`Queue unavailable: ${queueError}`)} />}
        <StatGrid>
          <StatCard label="Waiting" value={fmtNumber(counts.waiting)} tone={(counts.waiting ?? 0) > 100 ? "warning" : "default"} />
          <StatCard label="Active" value={fmtNumber(counts.active)} />
          <StatCard label="Delayed" value={fmtNumber(counts.delayed)} hint="Retry backoff" />
          <StatCard label="Failed" value={fmtNumber(counts.failed)} tone={counts.failed ? "negative" : "default"} hint="Kept: last 5,000" />
          <StatCard label="Completed" value={fmtNumber(counts.completed)} hint="Kept: last 1,000" />
          <StatCard
            label="State"
            value={queueError ? "Unreachable" : isPaused ? "Paused" : "Running"}
            tone={queueError ? "negative" : isPaused ? "warning" : "positive"}
          />
        </StatGrid>

        <Section title={`Failed jobs (${failed.length})`} description="Latest 50 after all retries" bodyClassName="p-0">
          <DataTable
            rows={failed}
            rowKey={(j) => j.id}
            empty="No failed jobs. 🎉"
            columns={[
              { key: "type", header: "Type", cell: (j) => <Pill>{j.type}</Pill> },
              {
                key: "user",
                header: "User",
                cell: (j) => (
                  <Link to="/users/$userId" params={{ userId: j.userId }} className="hover:underline">
                    <Mono>{j.userId.slice(0, 10)}</Mono>
                  </Link>
                ),
              },
              {
                key: "reason",
                header: "Error",
                cell: (j) => <span className="text-xs text-destructive">{j.failedReason}</span>,
              },
              { key: "attempts", header: "Attempts", cell: (j) => j.attemptsMade, className: "tabular-nums" },
              { key: "at", header: "Failed", cell: (j) => fmtDateTime(j.finishedOn ?? j.timestamp), className: "whitespace-nowrap" },
              {
                key: "retry",
                header: "",
                className: "text-right",
                cell: (j) => (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={async () => {
                      try {
                        await adminRpc.queue.retry({ jobId: j.id });
                        toast.success("Job re-queued");
                        await refresh();
                      } catch (err) {
                        toast.error(err instanceof Error ? err.message : String(err));
                      }
                    }}
                  >
                    <RotateCcw /> Retry
                  </Button>
                ),
              },
            ]}
          />
        </Section>

        <div className="grid gap-6 lg:grid-cols-3">
          <Section title="Push coverage">
            <div className="mb-4 grid grid-cols-3 gap-2 text-center">
              <div>
                <div className="text-xl font-semibold">{push.totals.users}</div>
                <div className="text-xs text-muted-foreground">users</div>
              </div>
              <div>
                <div className="text-xl font-semibold">{push.totals.subscriptions}</div>
                <div className="text-xs text-muted-foreground">devices</div>
              </div>
              <div>
                <div className="text-xl font-semibold">{push.totals.new7d}</div>
                <div className="text-xs text-muted-foreground">new 7d</div>
              </div>
            </div>
            <div className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">Platform</div>
            <BarList items={push.byPlatform.map((p) => ({ label: p.name, value: p.count }))} />
            <div className="mb-2 mt-4 text-xs font-medium uppercase tracking-wide text-muted-foreground">Push service</div>
            <BarList items={push.byService.map((p) => ({ label: p.name, value: p.count }))} />
          </Section>

          <Section title="Recent subscriptions" className="lg:col-span-2" bodyClassName="p-0">
            <DataTable
              rows={push.recent}
              rowKey={(s) => s.id}
              empty="No subscriptions."
              columns={[
                {
                  key: "user",
                  header: "User",
                  cell: (s) => (
                    <Link to="/users/$userId" params={{ userId: s.userId }} className="hover:underline">
                      {s.userEmail}
                    </Link>
                  ),
                },
                { key: "device", header: "Device", cell: (s) => describeUserAgent(s.userAgent) },
                { key: "service", header: "Service", cell: (s) => <Mono>{s.endpointHost}</Mono> },
                { key: "at", header: "Subscribed", cell: (s) => fmtAgo(s.createdAt), className: "whitespace-nowrap" },
              ]}
            />
          </Section>
        </div>
      </div>
    </>
  );
}
