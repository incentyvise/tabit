import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { z } from "zod";
import { orpc } from "@/lib/orpc";
import { displayName, fmtAgo, fmtDate, fmtNumber } from "@/lib/format";
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
  filter: z.enum(["all", "admins", "banned"]).optional().catch(undefined),
  sort: z.enum(["createdAt", "lastSeenAt", "expenseCount", "name"]).optional().catch(undefined),
  offset: z.number().int().min(0).optional().catch(undefined),
});

export const Route = createFileRoute("/_admin/users/")({
  validateSearch: searchSchema,
  component: UsersPage,
});

const LIMIT = 50;

function UsersPage() {
  const search = Route.useSearch();
  const navigate = useNavigate({ from: Route.fullPath });
  const filter = search.filter ?? "all";
  const sort = search.sort ?? "createdAt";
  const offset = search.offset ?? 0;

  const query = useQuery({
    ...orpc.users.list.queryOptions({
      input: { search: search.q || undefined, filter, sort, limit: LIMIT, offset },
    }),
    placeholderData: keepPreviousData,
  });

  const setSearch = (patch: Partial<z.infer<typeof searchSchema>>) =>
    void navigate({ search: (prev) => ({ ...prev, offset: undefined, ...patch }) });

  return (
    <>
      <PageHeader
        title="Users"
        description={query.data ? `${fmtNumber(query.data.total)} matching` : "All accounts"}
      />
      {query.isError && <ErrorState error={query.error} />}
      <Section
        bodyClassName="p-0"
        title={
          <div className="flex flex-wrap items-center gap-2">
            <SearchInput
              value={search.q ?? ""}
              onChange={(q) => setSearch({ q: q || undefined })}
              placeholder="Email, name, username or id"
            />
            <Segmented
              value={filter}
              onChange={(v) => setSearch({ filter: v === "all" ? undefined : v })}
              options={[
                { value: "all", label: "All" },
                { value: "admins", label: "Admins" },
                { value: "banned", label: "Banned" },
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
              <SelectItem value="lastSeenAt">Last seen</SelectItem>
              <SelectItem value="expenseCount">Most expenses</SelectItem>
              <SelectItem value="name">Name</SelectItem>
            </SelectContent>
          </Select>
        }
      >
        <DataTable
          loading={query.isPending}
          rows={query.data?.items}
          rowKey={(u) => u.id}
          onRowClick={(u) => void navigate({ to: "/users/$userId", params: { userId: u.id } })}
          columns={[
            {
              key: "user",
              header: "User",
              cell: (u) => (
                <div className="min-w-0">
                  <div className="font-medium">{displayName(u)}</div>
                  <div className="text-xs text-muted-foreground">
                    {u.email}
                    {u.username && ` · @${u.username}`}
                  </div>
                </div>
              ),
            },
            { key: "joined", header: "Joined", cell: (u) => fmtDate(u.createdAt), className: "whitespace-nowrap" },
            {
              key: "seen",
              header: "Last seen",
              cell: (u) => <span className="text-muted-foreground">{fmtAgo(u.lastSeenAt)}</span>,
              className: "whitespace-nowrap",
            },
            { key: "tabs", header: "Tabs", cell: (u) => u.tabCount, className: "text-right tabular-nums" },
            {
              key: "expenses",
              header: "Expenses",
              cell: (u) => u.expenseCount,
              className: "text-right tabular-nums",
            },
            {
              key: "status",
              header: "Status",
              cell: (u) => (
                <div className="flex gap-1">
                  {u.role === "admin" && <Pill tone="primary">Admin</Pill>}
                  {u.banned && <Pill tone="negative">Banned</Pill>}
                </div>
              ),
            },
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
