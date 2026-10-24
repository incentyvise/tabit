"use client";

import { signOutAndClear } from "@/lib/session-cache";
import { Button } from "@/components/ui/button";
import { LogOut } from "lucide-react";

export function SignOutButton() {
  return (
    <Button
      variant="destructive"
      size="sm"
      onClick={() => void signOutAndClear()}
    >
      <LogOut />
      Log Out
    </Button>
  );
}
