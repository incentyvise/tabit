import { useState, useMemo } from "react";
import { useNavigate } from "@/lib/navigation";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api-client";
import { ReceiptText, ArrowDownAZ } from "lucide-react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { UserAvatar } from "@/components/user-avatar";
import { authClient } from "@/lib/auth-client";
import { motion } from "framer-motion";
import {
  staggerContainer,
  staggerItemAt,
  useListEntrance,
} from "@/lib/animations";
import { AnimatedCard } from "@/components/motion/animated-card";
import { TabListItem } from "@/components/tab-list-item";
import { TabListSkeleton } from "@/components/page-skeletons";
import { formatAppDate } from "@/lib/format-date";
import { splitSettledTabs } from "@/lib/tab-sections";
import { pendingTabInviteRequestsQuery, tabsQuery } from "@/lib/queries";

type TabSort = "expenses" | "recent" | "name";

export function TabsPage() {
  const [sortBy, setSortBy] = useState<TabSort>("recent");
  const navigate = useNavigate();
  const listInitial = useListEntrance("tabs");
  const { data: session } = authClient.useSession();
  const currentUserId = session?.user?.id ?? "";
  type TabItem = {
    id: string;
    name: string;
    currency?: string;
    balance?: number;
    isSettled?: boolean;
    memberUserIds?: string[];
    expenseCount?: number;
    lastExpenseDate?: string | null;
  };
  type TabInviteItem = {
    id: string;
    tabId: string;
    fromUserId: string;
    tabName: string;
    fromUserName: string | null;
    fromUserUsername: string | null;
    createdAt: string;
  };

  const { data: tabsData, isPending: tabsPending } = useQuery(tabsQuery());
  const tabs = useMemo(() => (tabsData ?? []) as TabItem[], [tabsData]);
  const sortedTabs = useMemo(() => {
    const arr = [...tabs];
    if (sortBy === "name") {
      arr.sort((a, b) =>
        (a.name ?? "")
          .toLowerCase()
          .localeCompare((b.name ?? "").toLowerCase()),
      );
    } else if (sortBy === "recent") {
      arr.sort((a, b) => {
        const aDate = a.lastExpenseDate
          ? new Date(a.lastExpenseDate).getTime()
          : 0;
        const bDate = b.lastExpenseDate
          ? new Date(b.lastExpenseDate).getTime()
          : 0;
        return bDate - aDate;
      });
    } else {
      arr.sort((a, b) => (b.expenseCount ?? 0) - (a.expenseCount ?? 0));
    }
    return arr;
  }, [tabs, sortBy]);
  const { active: activeTabs, settled: settledTabs } = useMemo(
    () => splitSettledTabs(sortedTabs),
    [sortedTabs],
  );
  const { data: tabInvitesData } = useQuery(pendingTabInviteRequestsQuery());
  const pendingTabInvites = (tabInvitesData ??
    []) as unknown as TabInviteItem[];

  function renderTab(t: TabItem, i: number) {
    return (
      <motion.div key={t.id} variants={staggerItemAt(i)}>
        <AnimatedCard>
          <TabListItem
            item={{
              type: "group",
              id: t.id,
              name: t.name,
              balance: t.balance ?? 0,
              currency: t.currency ?? "USD",
              expenseCount: t.expenseCount ?? 0,
              lastExpenseDate: t.lastExpenseDate,
              memberUserIds: t.memberUserIds,
            }}
            currentUserId={currentUserId}
            href={`/tabs/${t.id}`}
          />
        </AnimatedCard>
      </motion.div>
    );
  }

  async function handleAcceptTabInvite(requestId: string) {
    const result = await api.tabInvites.acceptRequest(requestId);
    if (result.success && result.tabId) {
      navigate(`/tabs/${result.tabId}`);
    }
  }

  async function handleRejectTabInvite(requestId: string) {
    await api.tabInvites.rejectRequest(requestId);
  }

  return (
    <div className="p-4">
      <div className="mx-auto max-w-2xl space-y-6">
        {pendingTabInvites.length > 0 && (
          <section className="space-y-4">
            <h2 className="text-base font-medium mb-1">Tab invites</h2>
            <p className="text-xs text-muted-foreground mb-4">
              Accept or reject incoming tab invites
            </p>
            <motion.div
              className="flex flex-col gap-3"
              variants={staggerContainer}
              initial="initial"
              animate="animate"
            >
              {pendingTabInvites.map((r) => (
                <div
                  key={r.id}
                  className="flex flex-col gap-3 rounded-xl border border-border bg-card/50 p-4"
                >
                  <div className="flex items-start gap-3">
                    <ReceiptText className="h-5 w-5 shrink-0 text-tab-icon mt-0.5" />
                    <div className="min-w-0 flex-1">
                      <p className="font-medium">Invite to join {r.tabName}</p>
                      <p className="mt-1 flex items-center gap-2 text-xs text-muted-foreground">
                        <UserAvatar userId={r.fromUserId} size="xs" />
                        <span>
                          by {r.fromUserName ?? r.fromUserUsername ?? "Unknown"}
                          {r.fromUserUsername && (
                            <span className="ml-0.5">
                              @{r.fromUserUsername}
                            </span>
                          )}
                        </span>
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center justify-between gap-2 pt-1">
                    <span className="text-xs text-muted-foreground">
                      {formatAppDate(r.createdAt)}
                    </span>
                    <div className="flex gap-2">
                      <Button
                        size="sm"
                        variant="ghost"
                        className="text-muted-foreground hover:text-foreground"
                        onClick={() => handleRejectTabInvite(r.id)}
                      >
                        Reject
                      </Button>
                      <Button
                        size="sm"
                        variant="positive"
                        onClick={() => handleAcceptTabInvite(r.id)}
                      >
                        Accept
                      </Button>
                    </div>
                  </div>
                </div>
              ))}
            </motion.div>
          </section>
        )}

        <section className="space-y-4">
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <h2 className="text-base font-semibold text-foreground">
                Your tabs
              </h2>
              <p className="text-xs text-muted-foreground mt-0.5">
                Create a tab or tap to view
              </p>
            </div>
            {tabs.length > 0 && (
              <Select
                value={sortBy}
                onValueChange={(v) => setSortBy(v as TabSort)}
              >
                <SelectTrigger className="shrink-0 w-fit h-8 text-xs">
                  <ArrowDownAZ className="h-4 w-4 shrink-0 opacity-70 mr-2" />
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="recent">Most recent</SelectItem>
                  <SelectItem value="expenses">Most expenses</SelectItem>
                  <SelectItem value="name">Alphabetical</SelectItem>
                </SelectContent>
              </Select>
            )}
          </div>
          {tabsPending ? (
            <TabListSkeleton />
          ) : !tabs || tabs.length === 0 ? (
            <p className="rounded-lg border border-dashed border-border p-8 text-center text-muted-foreground">
              No tabs yet. Use the new tab button above.
            </p>
          ) : (
            <motion.div
              className="flex flex-col gap-3"
              variants={staggerContainer}
              initial={listInitial}
              animate="animate"
            >
              {activeTabs.length === 0 && (
                <p className="rounded-lg border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
                  Everything's settled. Older tabs are under Settled below.
                </p>
              )}
              {activeTabs.map((t, i) => renderTab(t, i))}
            </motion.div>
          )}
        </section>

        {settledTabs.length > 0 && (
          <section>
            {/* Collapsed by default; long-settled tabs are rarely needed. */}
            <Accordion type="single" collapsible>
              <AccordionItem value="settled" className="border-b-0">
                <AccordionTrigger className="py-2 hover:no-underline">
                  <span className="block min-w-0 text-left">
                    <span className="block text-base font-semibold text-foreground">
                      Settled ({settledTabs.length})
                    </span>
                    <span className="mt-0.5 block text-xs font-normal text-muted-foreground">
                      All square, no activity in the last 7 days
                    </span>
                  </span>
                </AccordionTrigger>
                <AccordionContent className="pb-0 pt-3">
                  <div className="flex flex-col gap-3">
                    {settledTabs.map((t, i) => renderTab(t, i))}
                  </div>
                </AccordionContent>
              </AccordionItem>
            </Accordion>
          </section>
        )}
      </div>
    </div>
  );
}
