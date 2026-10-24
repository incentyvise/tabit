import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { orpc } from "@/lib/orpc";
import { displayName, fmtDate, fmtDateTime, fmtMoney, fmtNumber } from "@/lib/format";
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
import { AuditTable } from "@/components/audit-table";
import { ExpenseTable } from "@/components/expense-table";
import { RecurringTable } from "@/components/recurring-table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

export const Route = createFileRoute("/_admin/tabs/$tabId")({
  component: TabDetailPage,
});

function TabDetailPage() {
  const { tabId } = Route.useParams();
  const query = useQuery(orpc.tabs.get.queryOptions({ input: { tabId } }));

  if (query.isError) return <ErrorState error={query.error} />;
  if (!query.data) return <LoadingBlock rows={4} />;

  const { tab, totals, members, participants, expenses, settlements, recurringRules, invites, audit } = query.data;
  const placeholders = participants.filter((p) => p.kind === "placeholder");
  const title = tab.isDirect ? members.map((m) => displayName(m)).join(" ↔ ") : tab.name;

  return (
    <>
      <PageHeader
        title={
          <span className="flex items-center gap-2">
            {title}
            <Pill>{tab.isDirect ? "Direct" : "Group"}</Pill>
          </span>
        }
        description={
          <>
            <Mono>{tab.id}</Mono> · {tab.currency} · created {fmtDate(tab.createdAt)}
          </>
        }
      />

      <div className="space-y-6">
        <StatGrid>
          <StatCard label="Members" value={members.length} hint={placeholders.length ? `+${placeholders.length} placeholders` : undefined} />
          <StatCard label="Expenses" value={fmtNumber(expenses.filter((e) => !e.deletedAt).length)} hint={totals.deletedExpenses ? `${totals.deletedExpenses} deleted` : undefined} />
          <StatCard label="Expense volume" value={fmtMoney(totals.expenseVolume, tab.currency)} />
          <StatCard label="Settled" value={fmtMoney(totals.settlementVolume, tab.currency)} hint={`${settlements.length} payments`} />
          <StatCard label="Recurring" value={recurringRules.length} />
          <StatCard label="Pending invites" value={invites.length} />
        </StatGrid>

        <div className="grid gap-6 lg:grid-cols-2">
          <Section title="Members" bodyClassName="p-0">
            <DataTable
              rows={members}
              rowKey={(m) => m.userId}
              columns={[
                {
                  key: "user",
                  header: "User",
                  cell: (m) => (
                    <Link to="/users/$userId" params={{ userId: m.userId }} className="hover:underline">
                      <div className="font-medium">{displayName(m)}</div>
                      <div className="text-xs text-muted-foreground">{m.email}</div>
                    </Link>
                  ),
                },
                { key: "role", header: "Role", cell: (m) => <Pill tone={m.role === "owner" ? "primary" : "neutral"}>{m.role}</Pill> },
              ]}
            />
          </Section>

          <Section title="Placeholders & invites" bodyClassName="p-0">
            <DataTable
              rows={[
                ...placeholders.map((p) => ({
                  key: p.id,
                  label: p.displayName,
                  kind: p.mergedAt ? "merged placeholder" : "placeholder",
                  when: p.mergedAt ?? p.createdAt,
                })),
                ...invites.map((i) => ({
                  key: i.id,
                  label: i.kind === "link" ? `Invite link by ${i.fromName}` : `${i.fromName} → ${i.toName}`,
                  kind: i.kind === "link" ? "invite link" : "invite request",
                  when: i.createdAt,
                })),
              ]}
              rowKey={(r) => r.key}
              empty="None."
              columns={[
                { key: "label", header: "Name", cell: (r) => r.label },
                { key: "kind", header: "Kind", cell: (r) => <Pill>{r.kind}</Pill> },
                { key: "when", header: "When", cell: (r) => fmtDate(r.when), className: "whitespace-nowrap" },
              ]}
            />
          </Section>
        </div>

        <Tabs defaultValue="expenses">
          <TabsList>
            <TabsTrigger value="expenses">Expenses ({expenses.length})</TabsTrigger>
            <TabsTrigger value="settlements">Settlements ({settlements.length})</TabsTrigger>
            <TabsTrigger value="recurring">Recurring ({recurringRules.length})</TabsTrigger>
            <TabsTrigger value="audit">Audit ({audit.length})</TabsTrigger>
          </TabsList>
          <TabsContent value="expenses">
            <Section bodyClassName="p-0">
              <ExpenseTable rows={expenses} showTab={false} />
            </Section>
          </TabsContent>
          <TabsContent value="settlements">
            <Section bodyClassName="p-0">
              <DataTable
                rows={settlements}
                rowKey={(s) => s.id}
                empty="No settlements."
                columns={[
                  { key: "from", header: "From", cell: (s) => s.fromName ?? "—" },
                  { key: "to", header: "To", cell: (s) => s.toName ?? "—" },
                  {
                    key: "amount",
                    header: "Amount",
                    className: "text-right tabular-nums whitespace-nowrap",
                    cell: (s) =>
                      s.currency && s.currency !== tab.currency
                        ? `${fmtMoney(s.originalAmount, s.currency)} (${fmtMoney(s.amount, tab.currency)})`
                        : fmtMoney(s.amount, tab.currency),
                  },
                  { key: "date", header: "Date", cell: (s) => fmtDate(s.settlementDate), className: "whitespace-nowrap" },
                  { key: "created", header: "Recorded", cell: (s) => fmtDateTime(s.createdAt), className: "whitespace-nowrap" },
                ]}
              />
            </Section>
          </TabsContent>
          <TabsContent value="recurring">
            <Section bodyClassName="p-0">
              <RecurringTable rows={recurringRules} showTab={false} />
            </Section>
          </TabsContent>
          <TabsContent value="audit">
            <Section bodyClassName="p-0">
              <AuditTable rows={audit} showTab={false} />
            </Section>
          </TabsContent>
        </Tabs>
      </div>
    </>
  );
}
