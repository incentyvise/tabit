import { useEffect, useState, type FormEvent } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { KeyRound, Loader2, Mail, ShieldCheck } from "lucide-react";
import { authClient } from "@/lib/auth-client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Spinner } from "@/components/ui/spinner";

export const Route = createFileRoute("/login")({
  component: LoginPage,
});

function LoginPage() {
  const navigate = useNavigate();
  const { data: session, isPending } = authClient.useSession();
  const [step, setStep] = useState<"email" | "otp">("email");
  const [email, setEmail] = useState("");
  const [otp, setOtp] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!isPending && session?.user) void navigate({ to: "/", replace: true });
  }, [isPending, session, navigate]);

  async function sendCode(e: FormEvent) {
    e.preventDefault();
    const trimmed = email.trim();
    if (!/^\S+@\S+\.\S+$/.test(trimmed)) {
      setError("Enter a valid email address");
      return;
    }
    setBusy(true);
    setError(null);
    const { error: err } = await authClient.emailOtp.sendVerificationOtp({
      email: trimmed,
      type: "sign-in",
    });
    setBusy(false);
    if (err) {
      setError(err.message ?? "Failed to send code");
      return;
    }
    setEmail(trimmed);
    setOtp("");
    setStep("otp");
  }

  async function verify(e: FormEvent) {
    e.preventDefault();
    if (!/^\d{6}$/.test(otp)) {
      setError("Enter the 6-digit code");
      return;
    }
    setBusy(true);
    setError(null);
    const { error: err } = await authClient.signIn.emailOtp({ email, otp });
    setBusy(false);
    if (err) {
      setError(err.message ?? "Invalid or expired code");
      return;
    }
    void navigate({ to: "/", replace: true });
  }

  if (isPending || session?.user) {
    return (
      <main className="flex min-h-screen items-center justify-center">
        <Spinner />
      </main>
    );
  }

  return (
    <main className="flex min-h-screen flex-col items-center justify-center bg-linear-to-b from-primary/5 via-background to-background p-6">
      <div className="mb-6 flex items-center gap-2 text-sm text-muted-foreground">
        <ShieldCheck className="size-4 text-primary" /> Tab Admin
      </div>
      <Card className="w-full max-w-sm shadow-lg">
        <CardHeader className="space-y-1 pb-4">
          <div className="flex items-center gap-2">
            {step === "email" ? (
              <Mail className="size-5 text-primary" />
            ) : (
              <KeyRound className="size-5 text-primary" />
            )}
            <CardTitle className="text-lg">{step === "email" ? "Admin sign in" : "Enter code"}</CardTitle>
          </div>
          <CardDescription>
            {step === "email"
              ? "We'll email you a one-time code. Admin access only."
              : `We sent a 6-digit code to ${email}.`}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {step === "email" ? (
            <form onSubmit={sendCode} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="email">Email</Label>
                <Input
                  id="email"
                  type="email"
                  autoComplete="email"
                  autoFocus
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                />
              </div>
              {error && <p className="text-sm text-destructive">{error}</p>}
              <Button type="submit" className="w-full" disabled={busy}>
                {busy && <Loader2 className="animate-spin" />} Send code
              </Button>
            </form>
          ) : (
            <form onSubmit={verify} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="otp">Code</Label>
                <Input
                  id="otp"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  autoFocus
                  maxLength={6}
                  value={otp}
                  onChange={(e) => setOtp(e.target.value.replace(/\D/g, ""))}
                  className="text-center font-mono text-lg tracking-[0.5em]"
                />
              </div>
              {error && <p className="text-sm text-destructive">{error}</p>}
              <Button type="submit" className="w-full" disabled={busy}>
                {busy && <Loader2 className="animate-spin" />} Sign in
              </Button>
              <Button
                type="button"
                variant="ghost"
                className="w-full"
                onClick={() => {
                  setStep("email");
                  setError(null);
                }}
              >
                Use a different email
              </Button>
            </form>
          )}
        </CardContent>
      </Card>
    </main>
  );
}
