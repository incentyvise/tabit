import { useEffect, useState } from "react";
import { Link } from "@/lib/navigation";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { recoverFromStaleBuild } from "@/src/lib/sw-update";

export function NotFoundPage() {
  // An installed app serves its cached shell, so a link to a screen added in a
  // newer build lands here. Check for that build before declaring a 404.
  const [checking, setChecking] = useState(true);
  useEffect(() => {
    let cancelled = false;
    void recoverFromStaleBuild({ onlyIfNewer: true }).then((updating) => {
      if (!cancelled && !updating) setChecking(false);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  if (checking) {
    return (
      <main className="flex min-h-screen items-center justify-center p-8">
        <Spinner />
      </main>
    );
  }

  return (
    <main className="flex min-h-screen flex-col items-center justify-center p-8">
      <h1 className="text-2xl font-bold">404</h1>
      <p className="mt-2 text-muted-foreground">Page not found</p>
      <Button asChild className="mt-4">
        <Link to="/">Go home</Link>
      </Button>
    </main>
  );
}
