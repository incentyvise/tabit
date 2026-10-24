import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { z } from "zod";
import { orpc } from "@/lib/orpc";
import { fmtNumber } from "@/lib/format";
import { ErrorState, FilterChip, PageHeader, Pagination, Section, Segmented } from "@/components/common";
import { AuditTable } from "@/components/audit-table";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

const searchSchema = z.object({
  source: z.enum(["expense", "settlement", "tab"]).optional().catch(undefined),
  action: z.string().optional().catch(undefined),
  userId: z.string().optional().catch(undefined),
  tabId: z.string().optional().catch(undefined),
  from: z.string().optional().catch(undefined),
  to: z.string().optional().catch(undefined),
  offset: z.number().int().min(0).optional().catch(undefined),
});

export const Route = createFileRoute("/_admin/audit")({
  validateSearch: searchSchema,
  component: AuditPage,
});

const LIMIT = 50;
const ALL = "__all";

function AuditPage() {
  const search = Route.useSearch();
  const navigate = useNavigate({ from: Route.fullPath });
  const offset = search.offset ?? 0;
  const actions = useQuery(orpc.audit.actions.queryOptions());

  const query = useQuery({
    ...orpc.audit.list.queryOptions({
      input: {
        source: search.source,
        action: search.action,
        userId: search.userId,
        tabId: search.tabId,
        from: search.from ? new Date(`${search.from}T00:00:00`) : undefined,
        to: search.to ? new Date(`${search.to}T23:59:59`) : undefined,
        limit: LIMIT,
        offset,
      },
    }),
    placeholderData: keepPreviousData,
  });

  const setSearch = (patch: Partial<z.infer<typeof searchSchema>>) =>
    void navigate({ search: (prev) => ({ ...prev, offset: undefined, ...patch }) });

  const actionOptions = [
    ...new Set(
      (actions.data ?? []).filter((a) => !search.source || a.source === search.source).map((a) => a.action),
    ),
  ];

  return (
    <>
      <PageHeader
        title="Audit log"
        description={
          query.data
            ? `${fmtNumber(query.data.total)} entries across expenses, settlements and tab events`
            : "Expense, settlement and tab events"
        }
      />
      {query.isError && <ErrorState error={query.error} />}
      <Section
        bodyClassName="p-0"
        title={
          <div className="flex flex-wrap items-center gap-2">
            <Segmented
              value={search.source ?? "all"}
              onChange={(v) => setSearch({ source: v === "all" ? undefined : v, action: undefined })}
              options={[
                { value: "all", label: "All" },
                { value: "expense", label: "Expenses" },
                { value: "settlement", label: "Settlements" },
                { value: "tab", label: "Tab events" },
              ]}
            />
            <Select
              value={search.action ?? ALL}
              onValueChange={(v) => setSearch({ action: v === ALL ? undefined : v })}
            >
              <SelectTrigger className="h-8 w-40 text-xs">
                <SelectValue placeholder="Any action" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>Any action</SelectItem>
                {actionOptions.map((a) => (
                  <SelectItem key={a} value={a}>
                    {a}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Input
              type="date"
              value={search.from ?? ""}
              onChange={(e) => setSearch({ from: e.target.value || undefined })}
              className="h-8 w-36 text-xs"
              aria-label="From"
            />
            <Input
              type="date"
              value={search.to ?? ""}
              onChange={(e) => setSearch({ to: e.target.value || undefined })}
              className="h-8 w-36 text-xs"
              aria-label="To"
            />
            {search.userId && (
              <FilterChip onClear={() => setSearch({ userId: undefined })}>
                user{" "}
                <Link to="/users/$userId" params={{ userId: search.userId }} className="underline">
                  {search.userId.slice(0, 8)}
                </Link>
              </FilterChip>
            )}
            {search.tabId && (
              <FilterChip onClear={() => setSearch({ tabId: undefined })}>
                tab{" "}
                <Link to="/tabs/$tabId" params={{ tabId: search.tabId }} className="underline">
                  {search.tabId.slice(0, 8)}
                </Link>
              </FilterChip>
            )}
          </div>
        }
      >
        {query.data ? (
          <AuditTable rows={query.data.items} />
        ) : (
          <div className="py-10 text-center text-sm text-muted-foreground">Loading…</div>
        )}
        <Pagination
          offset={offset}
          limit={LIMIT}
          total={query.data?.total}
          onChange={(o) => void navigate({ search: (prev) => ({ ...prev, offset: o || undefined }) })}
        />
      </Section>
    </>
  );
}
