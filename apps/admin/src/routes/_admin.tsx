import { useEffect, useState } from "react";
import { createFileRoute, Link, Outlet, useNavigate } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useTheme } from "next-themes";
import {
  Activity,
  Bot,
  Cpu,
  History,
  Inbox,
  LayoutDashboard,
  LogOut,
  Menu,
  Moon,
  Receipt,
  Repeat,
  ShieldAlert,
  ShieldCheck,
  Sun,
  Users,
  Wallet,
  X,
} from "lucide-react";
import { authClient } from "@/lib/auth-client";
import { orpc } from "@/lib/orpc";
import { pwaUrl } from "@/lib/config";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Spinner } from "@/components/ui/spinner";

export const Route = createFileRoute("/_admin")({
  component: AdminLayout,
});

const NAV = [
  { to: "/", label: "Overview", icon: LayoutDashboard },
  { to: "/users", label: "Users", icon: Users },
  { to: "/tabs", label: "Tabs", icon: Wallet },
  { to: "/expenses", label: "Expenses", icon: Receipt },
  { to: "/audit", label: "Audit log", icon: History },
  { to: "/recurring", label: "Recurring & FX", icon: Repeat },
  { to: "/queue", label: "Queue & push", icon: Inbox },
  { to: "/ai", label: "AI usage", icon: Bot },
  { to: "/system", label: "System", icon: Cpu },
] as const;

function FullScreen({ children }: { children: React.ReactNode }) {
  return <main className="flex min-h-screen items-center justify-center p-6">{children}</main>;
}

function AdminLayout() {
  const navigate = useNavigate();
  const { data: session, isPending } = authClient.useSession();
  const impersonating = !!session?.session.impersonatedBy;
  const me = useQuery({
    ...orpc.me.queryOptions(),
    enabled: !!session?.user && !impersonating,
  });

  useEffect(() => {
    if (!isPending && !session?.user) void navigate({ to: "/login", replace: true });
  }, [isPending, session, navigate]);

  if (isPending || (!session?.user && !isPending)) {
    return (
      <FullScreen>
        <Spinner />
      </FullScreen>
    );
  }

  if (impersonating) return <ImpersonationScreen name={session!.user.name || session!.user.email} />;

  if (me.isPending) {
    return (
      <FullScreen>
        <Spinner />
      </FullScreen>
    );
  }

  if (me.isError) return <NotAuthorized email={session!.user.email} message={me.error.message} />;

  return <Shell email={me.data.email} />;
}

function Shell({ email }: { email: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="flex h-screen overflow-hidden">
      <aside
        className={cn(
          "fixed inset-y-0 left-0 z-40 flex w-60 flex-col border-r border-border bg-sidebar transition-transform md:static md:translate-x-0",
          open ? "translate-x-0" : "-translate-x-full",
        )}
      >
        <div className="flex h-14 items-center justify-between gap-2 border-b border-border px-4">
          <div className="flex items-center gap-2 font-semibold">
            <img src="/icon-192x192.png" alt="" className="size-6 rounded-md" />
            Tab Admin
          </div>
          <Button variant="ghost" size="icon" className="md:hidden" onClick={() => setOpen(false)}>
            <X />
          </Button>
        </div>
        <nav className="flex-1 space-y-0.5 overflow-y-auto p-2">
          {NAV.map((item) => (
            <Link
              key={item.to}
              to={item.to}
              onClick={() => setOpen(false)}
              activeOptions={{ exact: item.to === "/" }}
              className="flex items-center gap-2.5 rounded-md px-3 py-2 text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
              activeProps={{ className: "bg-accent !text-foreground font-medium" }}
            >
              <item.icon className="size-4" />
              {item.label}
            </Link>
          ))}
        </nav>
        <SidebarFooter email={email} />
      </aside>
      {open && (
        <div className="fixed inset-0 z-30 bg-black/50 md:hidden" onClick={() => setOpen(false)} />
      )}
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-14 items-center gap-2 border-b border-border px-4 md:hidden">
          <Button variant="ghost" size="icon" onClick={() => setOpen(true)}>
            <Menu />
          </Button>
          <span className="font-semibold">Tab Admin</span>
        </header>
        <main className="min-h-0 flex-1 overflow-y-auto">
          <div className="mx-auto max-w-7xl p-4 md:p-8">
            <Outlet />
          </div>
        </main>
      </div>
    </div>
  );
}

function SidebarFooter({ email }: { email: string }) {
  const { resolvedTheme, setTheme } = useTheme();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  return (
    <div className="space-y-2 border-t border-border p-3">
      <div className="flex items-center gap-2 px-1 text-xs text-muted-foreground">
        <ShieldCheck className="size-3.5 text-primary" />
        <span className="truncate">{email}</span>
      </div>
      <div className="flex gap-1">
        <Button
          variant="ghost"
          size="sm"
          className="flex-1 justify-start"
          onClick={async () => {
            await authClient.signOut();
            queryClient.clear();
            void navigate({ to: "/login" });
          }}
        >
          <LogOut /> Sign out
        </Button>
        <Button
          variant="ghost"
          size="sm"
          aria-label="Toggle theme"
          onClick={() => setTheme(resolvedTheme === "dark" ? "light" : "dark")}
        >
          {resolvedTheme === "dark" ? <Sun /> : <Moon />}
        </Button>
      </div>
    </div>
  );
}

function ImpersonationScreen({ name }: { name: string }) {
  const [busy, setBusy] = useState(false);
  return (
    <FullScreen>
      <Card className="w-full max-w-md space-y-4 p-6">
        <div className="flex items-center gap-2 font-semibold">
          <Activity className="size-5 text-warning" /> Impersonating {name}
        </div>
        <p className="text-sm text-muted-foreground">
          This browser is signed in as this user (sessions last up to 1 hour). Open the app to see what
          they see, then come back here to return to your admin session.
        </p>
        <div className="flex gap-2">
          <Button asChild variant="outline" className="flex-1">
            <a href={pwaUrl} target="_blank" rel="noreferrer">
              Open app
            </a>
          </Button>
          <Button
            className="flex-1"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              await authClient.admin.stopImpersonating();
              window.location.reload();
            }}
          >
            Stop impersonating
          </Button>
        </div>
      </Card>
    </FullScreen>
  );
}

function NotAuthorized({ email, message }: { email: string; message: string }) {
  return (
    <FullScreen>
      <Card className="w-full max-w-md space-y-4 p-6">
        <div className="flex items-center gap-2 font-semibold">
          <ShieldAlert className="size-5 text-destructive" /> Not authorized
        </div>
        <p className="text-sm text-muted-foreground">
          {email} can't access the admin console. {message}
        </p>
        <Button
          variant="outline"
          onClick={async () => {
            await authClient.signOut();
            window.location.href = "/login";
          }}
        >
          <LogOut /> Sign out
        </Button>
      </Card>
    </FullScreen>
  );
}
