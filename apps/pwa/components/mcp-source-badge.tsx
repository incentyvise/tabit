import { Bot } from "lucide-react";
import { cn } from "@/lib/utils";

/** "via MCP · Claude": shown on changes an MCP client made for a user. */
export function McpSourceBadge({
  client,
  className,
}: {
  client: string | null | undefined;
  className?: string;
}) {
  if (!client) return null;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full border border-border bg-muted/50 px-1.5 py-px text-[10px] font-medium text-muted-foreground",
        className,
      )}
      title={`Made through ${client} using Tab's MCP server`}
    >
      <Bot className="h-3 w-3" />
      via MCP · {client}
    </span>
  );
}
