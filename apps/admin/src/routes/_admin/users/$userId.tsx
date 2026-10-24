import { useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Ban, KeyRound, LogOut, ShieldOff, UserRoundCog } from "lucide-react";
import { toast } from "sonner";
import { authClient } from "@/lib/auth-client";
import { adminRpc, orpc } from "@/lib/orpc";
import {
  describeUserAgent,
  displayName,
  fmtAgo,
  fmtDate,
  fmtDateTime,
  fmtNumber,
} from "@/lib/format";
import {
  DataTable,
  ErrorState,
  KeyValue,
  LoadingBlock,
  Mono,
  PageHeader,
  Pill,
  Section,
  StatCard,
  StatGrid,
} from "@/components/common";
import { AuditTable } from "@/components/audit-table";
import { ConfirmButton } from "@/components/confirm";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

export const Route = createFileRoute("/_admin/users/$userId")({
  component: UserDetailPage,
});

/** Better Auth client calls return { error } instead of throwing. */
async function authCall(promise: Promise<{ error: { message?: string } | null }>, success: string) {
  const { error } = await promise;
  if (error) throw new Error(error.message ?? "Request failed");
  toast.success(success);
}

function UserDetailPage() {
  const { userId } = Route.useParams();
  const queryClient = useQueryClient();
  const query = useQuery(orpc.users.get.queryOptions({ input: { userId } }));
  const refresh = () => queryClient.invalidateQueries({ queryKey: orpc.users.key() });

  if (query.isError) return <ErrorState error={query.error} />;
  if (!query.data) return <LoadingBlock rows={4} />;

  const { user, isAdmin, stats, tabs, sessions, apiKeys, pushSubscriptions, preferences, activity, ai } =
    query.data;

  return (
    <>
      <PageHeader
        title={
          <span className="flex items-center gap-2">
            {displayName(user)}
            {isAdmin && <Pill tone="primary">Admin</Pill>}
            {user.banned && <Pill tone="negative">Banned</Pill>}
          </span>
        }
        description={
          <>
            {user.email} · joined {fmtDate(user.createdAt)} · last seen {fmtAgo(user.lastSeenAt)}
          </>
        }
        actions={
          <>
            {!isAdmin && (
              <ConfirmButton
                variant="outline"
                size="sm"
                title={`Impersonate ${displayName(user)}?`}
                description="Your browser session switches to this user for up to an hour. Return from the admin console to restore your session."
                confirmLabel="Impersonate"
                onConfirm={async () => {
                  await authCall(authClient.admin.impersonateUser({ userId }), "Impersonating");
                  window.location.href = "/";
                }}
              >
                <UserRoundCog /> Impersonate
              </ConfirmButton>
            )}
            <ConfirmButton
              variant="outline"
              size="sm"
              disabled={sessions.length === 0}
              title="Revoke all sessions?"
              description={`Signs ${displayName(user)} out on all ${sessions.length} devices.`}
              confirmLabel="Revoke all"
              destructive
              onConfirm={async () => {
                await authCall(authClient.admin.revokeUserSessions({ userId }), "Sessions revoked");
                await refresh();
              }}
            >
              <LogOut /> Sign out everywhere
            </ConfirmButton>
            {!isAdmin &&
              (user.banned ? (
                <ConfirmButton
                  variant="outline"
                  size="sm"
                  title="Unban user?"
                  description="They will be able to sign in again."
                  confirmLabel="Unban"
                  onConfirm={async () => {
                    await authCall(authClient.admin.unbanUser({ userId }), "User unbanned");
                    await refresh();
                  }}
                >
                  <ShieldOff /> Unban
                </ConfirmButton>
              ) : (
                <BanDialog userId={userId} name={displayName(user)} onDone={refresh} />
              ))}
          </>
        }
      />

      <div className="space-y-6">
        {user.banned && (
          <Section className="border-destructive/40">
            <div className="text-sm">
              <span className="font-medium text-destructive">Banned</span>
              {user.banReason && <> — {user.banReason}</>}
              <span className="text-muted-foreground">
                {" "}
                · {user.banExpires ? `until ${fmtDateTime(user.banExpires)}` : "permanently"}
              </span>
            </div>
          </Section>
        )}

        <StatGrid>
          <StatCard label="Friends" value={fmtNumber(stats.friends)} />
          <StatCard label="Group tabs" value={fmtNumber(stats.groupTabs)} />
          <StatCard label="Expenses added" value={fmtNumber(user.expenseCount)} />
          <StatCard label="Settlements" value={fmtNumber(stats.settlementsRecorded)} />
          <StatCard label="Recurring rules" value={fmtNumber(stats.recurringRules)} />
          <StatCard label="AI calls" value={fmtNumber(stats.aiCalls)} />
        </StatGrid>

        <div className="grid gap-6 lg:grid-cols-3">
          <Section title="Profile" className="lg:col-span-1">
            <KeyValue
              items={[
                ["Id", <Mono key="id">{user.id}</Mono>],
                ["Username", user.username ? `@${user.username}` : "—"],
                ["Email verified", user.emailVerified ? "Yes" : "No"],
                ["Currency", user.defaultCurrency ?? "—"],
                ["Timezone", user.timezone ?? "—"],
                ["Role", user.role ?? "user"],
                ["Updated", fmtDateTime(user.updatedAt)],
                ["Pending friend requests", stats.pendingFriendRequests],
              ]}
            />
            {preferences.length > 0 && (
              <div className="mt-4 border-t border-border pt-4">
                <div className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  Preferences
                </div>
                <KeyValue items={preferences.map((p) => [p.key, <Mono key={p.key}>{p.value}</Mono>])} />
              </div>
            )}
          </Section>

          <Section title={`Tabs (${tabs.length})`} className="lg:col-span-2" bodyClassName="p-0">
            <DataTable
              rows={tabs}
              rowKey={(t) => t.id}
              empty="Not in any tabs."
              columns={[
                {
                  key: "name",
                  header: "Tab",
                  cell: (t) => (
                    <Link to="/tabs/$tabId" params={{ tabId: t.id }} className="font-medium hover:underline">
                      {t.isDirect ? `↔ ${t.memberNames ?? "Direct"}` : t.name}
                    </Link>
                  ),
                },
                {
                  key: "type",
                  header: "Type",
                  cell: (t) => <Pill>{t.isDirect ? "Direct" : t.role}</Pill>,
                },
                { key: "currency", header: "Currency", cell: (t) => t.currency },
                { key: "expenses", header: "Expenses", cell: (t) => t.expenseCount, className: "text-right tabular-nums" },
                { key: "created", header: "Created", cell: (t) => fmtDate(t.createdAt), className: "whitespace-nowrap" },
              ]}
            />
          </Section>
        </div>

        <Section title={`Sessions (${sessions.length})`} bodyClassName="p-0">
          <DataTable
            rows={sessions}
            rowKey={(s) => s.id}
            empty="No active sessions."
            columns={[
              {
                key: "device",
                header: "Device",
                cell: (s) => (
                  <div>
                    <div className="font-medium">{describeUserAgent(s.userAgent)}</div>
                    <div className="max-w-md truncate text-xs text-muted-foreground" title={s.userAgent ?? ""}>
                      {s.userAgent ?? "—"}
                    </div>
                  </div>
                ),
              },
              { key: "ip", header: "IP", cell: (s) => <Mono>{s.ipAddress ?? "—"}</Mono> },
              { key: "active", header: "Last active", cell: (s) => fmtAgo(s.updatedAt), className: "whitespace-nowrap" },
              { key: "expires", header: "Expires", cell: (s) => fmtDate(s.expiresAt), className: "whitespace-nowrap" },
              {
                key: "flags",
                header: "",
                cell: (s) =>
                  s.impersonatedBy ? <Pill tone="warning">Impersonation</Pill> : new Date(s.expiresAt) < new Date() ? <Pill>Expired</Pill> : null,
              },
              {
                key: "revoke",
                header: "",
                className: "text-right",
                cell: (s) => (
                  <ConfirmButton
                    variant="ghost"
                    size="sm"
                    title="Revoke this session?"
                    description={`${describeUserAgent(s.userAgent)} will be signed out.`}
                    confirmLabel="Revoke"
                    destructive
                    onConfirm={async () => {
                      await adminRpc.users.revokeSession({ sessionId: s.id });
                      toast.success("Session revoked");
                      await refresh();
                    }}
                  >
                    Revoke
                  </ConfirmButton>
                ),
              },
            ]}
          />
        </Section>

        <div className="grid gap-6 lg:grid-cols-2">
          <Section title={`API keys (${apiKeys.length})`} bodyClassName="p-0">
            <DataTable
              rows={apiKeys}
              rowKey={(k) => k.id}
              empty="No API keys."
              columns={[
                {
                  key: "name",
                  header: "Key",
                  cell: (k) => (
                    <div className="flex items-center gap-2">
                      <KeyRound className="size-3.5 text-muted-foreground" />
                      <span className="font-medium">{k.name}</span>
                      <Mono>{k.keyPrefix}…</Mono>
                    </div>
                  ),
                },
                { key: "scopes", header: "Scopes", cell: (k) => k.scopes ?? "—" },
                { key: "created", header: "Created", cell: (k) => fmtDate(k.createdAt) },
                {
                  key: "revoke",
                  header: "",
                  className: "text-right",
                  cell: (k) => (
                    <ConfirmButton
                      variant="ghost"
                      size="sm"
                      title="Revoke API key?"
                      description={`"${k.name}" (${k.keyPrefix}…) will stop working immediately. This deletes the key.`}
                      confirmLabel="Revoke"
                      destructive
                      onConfirm={async () => {
                        await adminRpc.users.revokeApiKey({ apiKeyId: k.id });
                        toast.success("API key revoked");
                        await refresh();
                      }}
                    >
                      Revoke
                    </ConfirmButton>
                  ),
                },
              ]}
            />
          </Section>

          <Section title={`Push subscriptions (${pushSubscriptions.length})`} bodyClassName="p-0">
            <DataTable
              rows={pushSubscriptions}
              rowKey={(p) => p.id}
              empty="Push not enabled."
              columns={[
                { key: "device", header: "Device", cell: (p) => describeUserAgent(p.userAgent) },
                { key: "service", header: "Service", cell: (p) => <Mono>{p.endpointHost}</Mono> },
                { key: "created", header: "Subscribed", cell: (p) => fmtDate(p.createdAt) },
              ]}
            />
          </Section>
        </div>

        <div className="grid gap-6 lg:grid-cols-2">
          <Section
            title="Recent activity"
            actions={
              <Button asChild variant="ghost" size="sm">
                <Link to="/audit" search={{ userId }}>
                  View all
                </Link>
              </Button>
            }
            bodyClassName="p-0"
          >
            <AuditTable rows={activity} showUser={false} />
          </Section>

          <Section
            title="AI usage"
            actions={
              <Button asChild variant="ghost" size="sm">
                <Link to="/expenses" search={{ userId }}>
                  Expenses
                </Link>
              </Button>
            }
            bodyClassName="p-0"
          >
            <DataTable
              rows={ai}
              rowKey={(a) => a.id}
              empty="No AI calls."
              columns={[
                { key: "at", header: "When", cell: (a) => fmtDateTime(a.createdAt), className: "whitespace-nowrap" },
                {
                  key: "outcome",
                  header: "Outcome",
                  cell: (a) => <Pill tone={a.outcome === "success" ? "positive" : "warning"}>{a.outcome}</Pill>,
                },
                { key: "latency", header: "Latency", cell: (a) => `${a.latencyMs}ms`, className: "tabular-nums" },
                {
                  key: "err",
                  header: "Note",
                  cell: (a) => <span className="text-xs text-muted-foreground">{a.errorMessage ?? "—"}</span>,
                },
              ]}
            />
          </Section>
        </div>
      </div>
    </>
  );
}

const BAN_DURATIONS = [
  { value: "86400", label: "1 day" },
  { value: "604800", label: "7 days" },
  { value: "2592000", label: "30 days" },
  { value: "permanent", label: "Permanently" },
];

function BanDialog({ userId, name, onDone }: { userId: string; name: string; onDone: () => Promise<unknown> }) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [duration, setDuration] = useState("permanent");
  const [busy, setBusy] = useState(false);
  return (
    <Dialog open={open} onOpenChange={(o) => !busy && setOpen(o)}>
      <DialogTrigger asChild>
        <Button variant="destructive" size="sm">
          <Ban /> Ban
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Ban {name}?</DialogTitle>
          <DialogDescription>
            Revokes all of their sessions and blocks sign-in. Their data stays intact.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="ban-reason">Reason (shown to admins only)</Label>
            <Textarea id="ban-reason" value={reason} onChange={(e) => setReason(e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label>Duration</Label>
            <Select value={duration} onValueChange={setDuration}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {BAN_DURATIONS.map((d) => (
                  <SelectItem key={d.value} value={d.value}>
                    {d.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" disabled={busy} onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button
            variant="destructive"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              try {
                await authCall(
                  authClient.admin.banUser({
                    userId,
                    banReason: reason.trim() || undefined,
                    banExpiresIn: duration === "permanent" ? undefined : Number(duration),
                  }),
                  "User banned",
                );
                setOpen(false);
                await onDone();
              } catch (err) {
                toast.error(err instanceof Error ? err.message : String(err));
              } finally {
                setBusy(false);
              }
            }}
          >
            Ban user
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
