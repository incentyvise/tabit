import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { z } from "zod";
import { orpc } from "@/lib/orpc";
import { fmtNumber } from "@/lib/format";
import { ErrorState, FilterChip, PageHeader, Pagination, SearchInput, Section } from "@/components/common";
import { ExpenseTable } from "@/components/expense-table";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";

const searchSchema = z.object({
  q: z.string().optional().catch(undefined),
  tabId: z.string().optional().catch(undefined),
  userId: z.string().optional().catch(undefined),
  deleted: z.boolean().optional().catch(undefined),
  offset: z.number().int().min(0).optional().catch(undefined),
});

export const Route = createFileRoute("/_admin/expenses")({
  validateSearch: searchSchema,
  component: ExpensesPage,
});

const LIMIT = 50;

function ExpensesPage() {
  const search = Route.useSearch();
  const navigate = useNavigate({ from: Route.fullPath });
  const offset = search.offset ?? 0;

  const query = useQuery({
    ...orpc.expenses.list.queryOptions({
      input: {
        search: search.q || undefined,
        tabId: search.tabId,
        userId: search.userId,
        includeDeleted: search.deleted ?? false,
        limit: LIMIT,
        offset,
      },
    }),
    placeholderData: keepPreviousData,
  });

  const setSearch = (patch: Partial<z.infer<typeof searchSchema>>) =>
    void navigate({ search: (prev) => ({ ...prev, offset: undefined, ...patch }) });

  return (
    <>
      <PageHeader
        title="Expenses"
        description={query.data ? `${fmtNumber(query.data.total)} matching` : "Every expense across Tab"}
      />
      {query.isError && <ErrorState error={query.error} />}
      <Section
        bodyClassName="p-0"
        title={
          <div className="flex flex-wrap items-center gap-2">
            <SearchInput
              value={search.q ?? ""}
              onChange={(q) => setSearch({ q: q || undefined })}
              placeholder="Description or id"
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
        actions={
          <div className="flex items-center gap-2">
            <Switch
              id="deleted"
              checked={search.deleted ?? false}
              onCheckedChange={(v) => setSearch({ deleted: v || undefined })}
            />
            <Label htmlFor="deleted" className="text-xs">
              Include deleted
            </Label>
          </div>
        }
      >
        <ExpenseTable rows={query.data?.items} loading={query.isPending} />
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
