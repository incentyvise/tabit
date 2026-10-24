import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { RefreshCw } from "lucide-react";
import { orpc } from "@/lib/orpc";
import { fmtDateTime, fmtDuration, fmtNumber } from "@/lib/format";
import {
  DataTable,
  ErrorState,
  HealthDot,
  KeyValue,
  LoadingBlock,
  Mono,
  PageHeader,
  Section,
} from "@/components/common";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";

export const Route = createFileRoute("/_admin/system")({
  component: SystemPage,
});

function HealthCard({
  name,
  ok,
  detail,
}: {
  name: string;
  ok: boolean | null;
  detail: React.ReactNode;
}) {
  return (
    <Card className="p-4">
      <div className="flex items-center gap-2 text-sm font-medium">
        <HealthDot ok={ok} /> {name}
      </div>
      <div className="mt-1 text-xs text-muted-foreground">{detail}</div>
    </Card>
  );
}

function SystemPage() {
  const query = useQuery({ ...orpc.system.queryOptions(), refetchInterval: 30_000 });
  if (query.isError) return <ErrorState error={query.error} />;
  if (!query.data) return <LoadingBlock rows={4} />;

  const { api, database: db, redis, workers } = query.data;

  return (
    <>
      <PageHeader
        title="System"
        description="Service health and database footprint. Auto-refreshes every 30s."
        actions={
          <Button variant="outline" size="sm" disabled={query.isFetching} onClick={() => void query.refetch()}>
            <RefreshCw className={query.isFetching ? "animate-spin" : undefined} /> Refresh
          </Button>
        }
      />
      <div className="space-y-6">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <HealthCard name="API" ok detail={`Up ${fmtDuration(api.uptimeSeconds)} · ${api.nodeVersion}`} />
          <HealthCard
            name="Postgres"
            ok={db.ok}
            detail={db.ok ? `${db.dbLatencyMs}ms · ${db.connections} connections` : db.error}
          />
          <HealthCard
            name="Redis"
            ok={redis.ok}
            detail={redis.ok ? `${redis.latencyMs}ms ping` : redis.error}
          />
          <HealthCard
            name="Workers"
            ok={workers ? workers.ok : null}
            detail={
              workers
                ? workers.ok
                  ? `${workers.latencyMs}ms /health`
                  : (workers.error ?? `HTTP ${workers.status}`)
                : "Set WORKERS_HEALTH_URL on the API to check"
            }
          />
        </div>

        <div className="grid gap-6 lg:grid-cols-2">
          <Section title="API process">
            <KeyValue
              items={[
                ["Environment", api.env],
                ["Started", fmtDateTime(api.startedAt)],
                ["Node", api.nodeVersion],
                ["RSS", `${api.rssMb} MB`],
                ["Heap used", `${api.heapUsedMb} MB`],
              ]}
            />
          </Section>
          {db.ok && (
            <Section title="Database">
              <KeyValue
                items={[
                  ["Size", db.databaseSize],
                  ["Connections", db.connections],
                  ["Version", <span key="v" className="text-xs">{db.version}</span>],
                  [
                    "Latest migration",
                    db.migrations[0] ? (
                      <span key="m">
                        #{db.migrations[0].id} · {fmtDateTime(db.migrations[0].createdAt)}
                      </span>
                    ) : (
                      "—"
                    ),
                  ],
                ]}
              />
            </Section>
          )}
        </div>

        {db.ok && (
          <div className="grid gap-6 lg:grid-cols-2">
            <Section title="Tables" bodyClassName="p-0">
              <DataTable
                rows={db.tables}
                rowKey={(t) => t.table}
                columns={[
                  { key: "table", header: "Table", cell: (t) => <Mono className="text-foreground">{t.table}</Mono> },
                  { key: "rows", header: "Rows (est.)", cell: (t) => fmtNumber(t.rows), className: "text-right tabular-nums" },
                  { key: "size", header: "Size", cell: (t) => t.size, className: "text-right whitespace-nowrap" },
                ]}
              />
            </Section>
            <Section title="Recent migrations" bodyClassName="p-0">
              <DataTable
                rows={db.migrations}
                rowKey={(m) => String(m.id)}
                empty="Migration table not found."
                columns={[
                  { key: "id", header: "#", cell: (m) => m.id, className: "tabular-nums" },
                  { key: "hash", header: "Hash", cell: (m) => <Mono>{m.hash.slice(0, 12)}</Mono> },
                  { key: "at", header: "Applied", cell: (m) => fmtDateTime(m.createdAt), className: "whitespace-nowrap" },
                ]}
              />
            </Section>
          </div>
        )}
      </div>
    </>
  );
}
