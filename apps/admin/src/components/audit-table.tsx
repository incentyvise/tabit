import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { ChevronDown, ChevronRight } from "lucide-react";
import { fmtDateTime } from "@/lib/format";
import { JsonView, Pill } from "@/components/common";

export type AuditRow = {
  source: "expense" | "settlement" | "tab";
  id: string;
  action: string;
  tabId: string;
  tabName: string | null;
  entityId: string;
  userId: string;
  userName: string | null;
  userEmail: string | null;
  at: Date | string;
  details: unknown;
};

const SOURCE_TONE = { expense: "primary", settlement: "positive", tab: "warning" } as const;

const ACTION_TONE: Record<string, "positive" | "warning" | "negative" | "neutral"> = {
  create: "positive",
  update: "warning",
  delete: "negative",
};

export function AuditTable({
  rows,
  showTab = true,
  showUser = true,
}: {
  rows: AuditRow[];
  showTab?: boolean;
  showUser?: boolean;
}) {
  const [expanded, setExpanded] = useState<string | null>(null);
  if (rows.length === 0) {
    return <div className="py-10 text-center text-sm text-muted-foreground">No audit entries.</div>;
  }
  return (
    <div className="divide-y divide-border">
      {rows.map((r) => {
        const key = `${r.source}:${r.id}`;
        const open = expanded === key;
        return (
          <div key={key} className="px-3 py-2.5 text-sm">
            <button
              type="button"
              className="flex w-full items-start gap-2 text-left"
              onClick={() => setExpanded(open ? null : key)}
            >
              {open ? (
                <ChevronDown className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
              ) : (
                <ChevronRight className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
              )}
              <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-2 gap-y-1">
                <Pill tone={SOURCE_TONE[r.source]}>{r.source}</Pill>
                <Pill tone={ACTION_TONE[r.action] ?? "neutral"}>{r.action}</Pill>
                {showUser && (
                  <Link
                    to="/users/$userId"
                    params={{ userId: r.userId }}
                    onClick={(e) => e.stopPropagation()}
                    className="font-medium hover:underline"
                  >
                    {r.userName || r.userEmail || r.userId}
                  </Link>
                )}
                {showTab && (
                  <>
                    <span className="text-muted-foreground">in</span>
                    <Link
                      to="/tabs/$tabId"
                      params={{ tabId: r.tabId }}
                      onClick={(e) => e.stopPropagation()}
                      className="hover:underline"
                    >
                      {r.tabName || "Direct tab"}
                    </Link>
                  </>
                )}
              </div>
              <span className="shrink-0 text-xs text-muted-foreground">{fmtDateTime(r.at)}</span>
            </button>
            {open && (
              <div className="mt-2 space-y-1 pl-6">
                <div className="text-xs text-muted-foreground">
                  {r.source} id <code className="font-mono">{r.entityId}</code>
                </div>
                <JsonView value={r.details} />
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
