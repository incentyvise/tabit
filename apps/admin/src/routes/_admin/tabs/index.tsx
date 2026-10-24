import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { z } from "zod";
import { orpc } from "@/lib/orpc";
import { fmtAgo, fmtDate, fmtMoney, fmtNumber } from "@/lib/format";
import {
  DataTable,
  ErrorState,
  PageHeader,
  Pagination,
  Pill,
  SearchInput,
  Section,
  Segmented,
} from "@/components/common";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

const searchSchema = z.object({
  q: z.string().optional().catch(undefined),
  type: z.enum(["all", "group", "direct"]).optional().catch(undefined),
  sort: z.enum(["createdAt", "lastActivityAt", "expenseCount", "volume"]).optional().catch(undefined),
  offset: z.number().int().min(0).optional().catch(undefined),
});

export const Route = createFileRoute("/_admin/tabs/")({
  validateSearch: searchSchema,
  component: TabsPage,
});

const LIMIT = 50;

function TabsPage() {
  const search = Route.useSearch();
  const navigate = useNavigate({ from: Route.fullPath });
  const type = search.type ?? "all";
  const sort = search.sort ?? "createdAt";
  const offset = search.offset ?? 0;

  const query = useQuery({
    ...orpc.tabs.list.queryOptions({
      input: { search: search.q || undefined, type, sort, limit: LIMIT, offset },
    }),
    placeholderData: keepPreviousData,
  });

  const setSearch = (patch: Partial<z.infer<typeof searchSchema>>) =>
    void navigate({ search: (prev) => ({ ...prev, offset: undefined, ...patch }) });

  return (
    <>
      <PageHeader
        title="Tabs"
        description={query.data ? `${fmtNumber(query.data.total)} matching` : "Groups and direct tabs"}
      />
      {query.isError && <ErrorState error={query.error} />}
      <Section
        bodyClassName="p-0"
        title={
          <div className="flex flex-wrap items-center gap-2">
            <SearchInput
              value={search.q ?? ""}
              onChange={(q) => setSearch({ q: q || undefined })}
              placeholder="Tab name, member, or id"
            />
            <Segmented
              value={type}
              onChange={(v) => setSearch({ type: v === "all" ? undefined : v })}
              options={[
                { value: "all", label: "All" },
                { value: "group", label: "Groups" },
                { value: "direct", label: "Direct" },
              ]}
            />
          </div>
        }
        actions={
          <Select value={sort} onValueChange={(v) => setSearch({ sort: v as typeof sort })}>
            <SelectTrigger className="h-8 w-40 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="createdAt">Newest</SelectItem>
              <SelectItem value="lastActivityAt">Recent activity</SelectItem>
              <SelectItem value="expenseCount">Most expenses</SelectItem>
              <SelectItem value="volume">Largest volume</SelectItem>
            </SelectContent>
          </Select>
        }
      >
        <DataTable
          loading={query.isPending}
          rows={query.data?.items}
          rowKey={(t) => t.id}
          onRowClick={(t) => void navigate({ to: "/tabs/$tabId", params: { tabId: t.id } })}
          columns={[
            {
              key: "tab",
              header: "Tab",
              cell: (t) => (
                <div className="min-w-0">
                  <div className="flex items-center gap-2 font-medium">
                    {t.isDirect ? "Direct tab" : t.name}
                    {t.isDirect && <Pill>Direct</Pill>}
                  </div>
                  <div className="max-w-md truncate text-xs text-muted-foreground">{t.memberNames ?? "No members"}</div>
                </div>
              ),
            },
            {
              key: "members",
              header: "Members",
              className: "text-right tabular-nums",
              cell: (t) => (
                <>
                  {t.memberCount}
                  {t.placeholderCount > 0 && (
                    <span className="text-xs text-muted-foreground"> +{t.placeholderCount}</span>
                  )}
                </>
              ),
            },
            { key: "expenses", header: "Expenses", cell: (t) => t.expenseCount, className: "text-right tabular-nums" },
            {
              key: "volume",
              header: "Volume",
              cell: (t) => fmtMoney(t.volume, t.currency),
              className: "text-right tabular-nums whitespace-nowrap",
            },
            {
              key: "activity",
              header: "Last activity",
              cell: (t) => <span className="text-muted-foreground">{fmtAgo(t.lastActivityAt)}</span>,
              className: "whitespace-nowrap",
            },
            { key: "created", header: "Created", cell: (t) => fmtDate(t.createdAt), className: "whitespace-nowrap" },
          ]}
        />
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
