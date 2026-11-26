import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { Bot, Copy, Loader2, ShieldCheck, Unplug } from "lucide-react";
import { orpcClient } from "@/src/lib/orpc-client";
import { getApiUrl } from "@/lib/api";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

const CONNECTED_APPS_KEY = ["connectedApps"] as const;

function formatDay(d: Date | string | null): string | null {
  if (!d) return null;
  return new Date(d).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

/**
 * MCP clients (Claude, ChatGPT, Cursor…) connected to the account, plus the
 * server URL to add Tab to one. Disconnecting revokes access immediately.
 */
export function ConnectedAppsSection() {
  const queryClient = useQueryClient();
  const mcpUrl = `${getApiUrl().replace(/\/$/, "")}/mcp`;
  const [pending, setPending] = useState<{ clientId: string; label: string } | null>(null);
  const [revoking, setRevoking] = useState(false);

  const { data, isPending, isError } = useQuery({
    queryKey: CONNECTED_APPS_KEY,
    queryFn: () => orpcClient.connectedApps.list(),
  });
  const apps = data?.apps ?? [];

  async function copyUrl() {
    try {
      await navigator.clipboard.writeText(mcpUrl);
      toast.success("MCP server URL copied");
    } catch {
      toast.error("Couldn't copy. Select the URL and copy it manually.");
    }
  }

  async function revoke() {
    if (!pending) return;
    setRevoking(true);
    try {
      await orpcClient.connectedApps.revoke({ clientId: pending.clientId });
      toast.success(`${pending.label} disconnected`);
      await queryClient.invalidateQueries({ queryKey: CONNECTED_APPS_KEY });
      setPending(null);
    } catch {
      toast.error("Failed to disconnect. Try again.");
    } finally {
      setRevoking(false);
    }
  }

  return (
    <section className="space-y-4">
      <div className="rounded-xl border border-border bg-card/50 p-4">
        <h2 className="text-sm font-medium mb-1">Connected apps</h2>
        <p className="text-[11px] text-muted-foreground mb-4">
          Use Tab from Claude, ChatGPT, Cursor and other AI apps that support MCP. Add this server URL as a custom
          connector, then sign in when asked.
        </p>
        <div className="flex items-center gap-2 mb-4">
          <code className="min-w-0 flex-1 truncate rounded-md border border-border bg-muted/40 px-3 py-2 text-xs">
            {mcpUrl}
          </code>
          <Button variant="outline" size="icon" onClick={copyUrl} aria-label="Copy MCP server URL">
            <Copy className="h-4 w-4" />
          </Button>
        </div>

        {isPending ? (
          <div className="flex justify-center py-2">
            <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
          </div>
        ) : isError ? (
          <p className="text-xs text-destructive">Couldn't load connected apps.</p>
        ) : apps.length === 0 ? (
          <p className="text-xs text-muted-foreground">No apps connected yet.</p>
        ) : (
          <ul className="divide-y divide-border rounded-lg border border-border">
            {apps.map((app) => (
              <li key={app.clientId} className="flex items-center gap-3 p-3">
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-muted">
                  <Bot className="h-4 w-4 text-muted-foreground" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1">
                    <span className="truncate text-sm font-medium">{app.name}</span>
                    {app.verifiedAs ? <ShieldCheck className="h-3.5 w-3.5 shrink-0 text-primary" /> : null}
                  </div>
                  <p className="truncate text-[11px] text-muted-foreground">
                    {[
                      app.host,
                      app.scopes.includes("tab:write") ? "read & write" : "read only",
                      `connected ${formatDay(app.connectedAt)}`,
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  </p>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  className="gap-1 text-destructive"
                  onClick={() => setPending({ clientId: app.clientId, label: app.label })}
                >
                  <Unplug className="h-3.5 w-3.5" />
                  Disconnect
                </Button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <AlertDialog open={!!pending} onOpenChange={(open) => !open && setPending(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Disconnect {pending?.label}?</AlertDialogTitle>
            <AlertDialogDescription>
              It loses access to your Tab account right away. Expenses it already added stay. You can connect it
              again later.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={revoking}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={revoking}
              onClick={(e) => {
                e.preventDefault();
                void revoke();
              }}
            >
              {revoking ? <Loader2 className="h-4 w-4 animate-spin" /> : "Disconnect"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}
