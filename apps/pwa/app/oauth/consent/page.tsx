import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ShieldCheck, ShieldAlert, Loader2, Check, ExternalLink } from "lucide-react";
import { orpcClient } from "@/src/lib/orpc-client";
import { authClient, getAuthBaseUrl } from "@/lib/auth-client";
import { getSignedOAuthQuery, submitOAuthConsent } from "@/lib/oauth-flow";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Spinner } from "@/components/ui/spinner";

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center bg-linear-to-b from-primary/5 via-background to-background p-6 sm:p-8 top-nav-safe">
      <img src="/icon-192x192.png" alt="" className="mb-6 h-14 w-14 rounded-2xl shadow-md" />
      {children}
    </main>
  );
}

/**
 * OAuth consent for MCP clients (Claude, ChatGPT, Cursor…). Better Auth
 * redirects here from /oauth2/authorize with a signed query; the server
 * verifies it before we show which app is asking and what it can do.
 */
export function OAuthConsentPage() {
  const oauthQuery = getSignedOAuthQuery();
  const { data: session, isPending: sessionPending } = authClient.useSession();
  const [submitting, setSubmitting] = useState<"allow" | "deny" | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const context = useQuery({
    queryKey: ["oauth-consent", oauthQuery],
    queryFn: () => orpcClient.connectedApps.consentContext({ oauthQuery: oauthQuery! }),
    enabled: !!oauthQuery && !!session?.user,
    retry: false,
    gcTime: 0,
  });

  // Not signed in (cookie expired mid-flow): sign in, then come back here.
  useEffect(() => {
    if (!sessionPending && !session?.user && oauthQuery) {
      window.location.replace(`/login${window.location.search}`);
    }
  }, [sessionPending, session, oauthQuery]);

  async function decide(accept: boolean) {
    setSubmitting(accept ? "allow" : "deny");
    setSubmitError(null);
    try {
      const url = await submitOAuthConsent(accept, getAuthBaseUrl());
      window.location.href = url;
    } catch (e) {
      setSubmitError(e instanceof Error ? e.message : "Something went wrong");
      setSubmitting(null);
    }
  }

  if (!oauthQuery) {
    return (
      <Shell>
        <Alert variant="destructive" className="max-w-sm">
          <AlertDescription>
            This page is opened by apps connecting to Tab. Start the connection from the app (for example Claude) again.
          </AlertDescription>
        </Alert>
      </Shell>
    );
  }

  if (sessionPending || !session?.user || context.isPending) {
    return (
      <Shell>
        <Spinner />
      </Shell>
    );
  }

  if (context.isError) {
    return (
      <Shell>
        <Alert variant="destructive" className="max-w-sm">
          <AlertDescription>{context.error.message}</AlertDescription>
        </Alert>
      </Shell>
    );
  }

  const { client, redirectHost, scopes } = context.data;
  const verified = !!client.verifiedAs;
  const visibleScopes = scopes.filter((s) => s.scope !== "openid");

  return (
    <Shell>
      <Card className="w-full max-w-sm shadow-lg">
        <CardHeader className="space-y-2 pb-4">
          <div className="flex items-center gap-2">
            {verified ? (
              <ShieldCheck className="h-5 w-5 text-primary" />
            ) : (
              <ShieldAlert className="h-5 w-5 text-amber-500" />
            )}
            <CardTitle className="text-lg">Connect {client.name} to Tab?</CardTitle>
          </div>
          <CardDescription className="space-y-1">
            <span className="block">
              {verified ? (
                <>
                  Verified app from <strong>{client.host}</strong>.
                </>
              ) : (
                <>
                  This app says it is “{client.name}”
                  {client.host ? (
                    <>
                      {" "}
                      from <strong>{client.host}</strong>
                    </>
                  ) : null}
                  . Only continue if you started this from an app you trust.
                </>
              )}
            </span>
            <span className="block">
              Signed in as <strong>{session.user.email}</strong>.
            </span>
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <p className="mb-2 text-sm font-medium">It will be able to:</p>
            <ul className="space-y-2">
              {visibleScopes.map((s) => (
                <li key={s.scope} className="flex gap-2 text-sm text-muted-foreground">
                  <Check className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                  <span>{s.description}</span>
                </li>
              ))}
            </ul>
          </div>
          <p className="text-[11px] leading-relaxed text-muted-foreground">
            Tab data the app reads (names, balances, expense descriptions) is sent to that app and its AI provider.
            Changes it makes show as “via {client.name}” and notify the people involved. You can disconnect it any
            time from your profile.
          </p>
          {redirectHost ? (
            <p className="text-[11px] text-muted-foreground">
              You’ll be sent back to <span className="font-mono">{redirectHost}</span>.
            </p>
          ) : null}
          {client.uri ? (
            <a
              href={client.uri}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-[11px] text-muted-foreground underline"
            >
              {client.uri}
              <ExternalLink className="h-3 w-3" />
            </a>
          ) : null}
          {submitError ? (
            <Alert variant="destructive">
              <AlertDescription>{submitError}</AlertDescription>
            </Alert>
          ) : null}
          <div className="grid grid-cols-2 gap-3">
            <Button variant="outline" className="h-11" disabled={!!submitting} onClick={() => decide(false)}>
              {submitting === "deny" ? <Loader2 className="h-4 w-4 animate-spin" /> : "Cancel"}
            </Button>
            <Button className="h-11" disabled={!!submitting} onClick={() => decide(true)}>
              {submitting === "allow" ? <Loader2 className="h-4 w-4 animate-spin" /> : "Allow"}
            </Button>
          </div>
        </CardContent>
      </Card>
    </Shell>
  );
}
