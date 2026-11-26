import type { z } from "zod";
import type { McpServer, ToolAnnotations, CallToolResult } from "@modelcontextprotocol/server";
import { runWithWriteSource } from "data";
import { log, withSpan } from "otel";
import { READ_SCOPE, ToolError, WRITE_SCOPE, type McpUserContext } from "./context.js";
import type { Directory } from "./resolve.js";

export type ToolContext = McpUserContext & {
  dir: Directory;
  /** IANA timezone of the user, for calendar dates. */
  timeZone: string | null;
  /** True for write tools: names must match exactly (see `pickOne`). */
  strict: boolean;
};

/** What a handler returns: a one-line summary for the model plus structured data. */
export type ToolOutput = { summary: string; data?: unknown };

export type ToolSpec<S extends z.ZodObject = z.ZodObject> = {
  name: string;
  title: string;
  description: string;
  scope: "read" | "write";
  annotations?: Omit<ToolAnnotations, "title">;
  input: S;
  handler: (args: z.infer<S>, ctx: ToolContext) => Promise<ToolOutput>;
};

export function defineTool<S extends z.ZodObject>(spec: ToolSpec<S>): ToolSpec<S> {
  return spec;
}

function errorResult(message: string, details?: Record<string, unknown>): CallToolResult {
  const text = details ? `${message}\n${JSON.stringify(details)}` : message;
  return { content: [{ type: "text", text }], isError: true };
}

function okResult(out: ToolOutput): CallToolResult {
  const text = out.data === undefined ? out.summary : `${out.summary}\n${JSON.stringify(out.data)}`;
  return { content: [{ type: "text", text }] };
}

/**
 * Registers tools on a per-request server. Every call is scope-checked,
 * traced, logged, and run inside the MCP write source so anything it writes
 * is stamped "via MCP · <client>". Expected failures become `isError`
 * results the model can recover from; unexpected ones are logged and hidden.
 */
export function registerTools(
  server: McpServer,
  tools: ToolSpec[],
  baseCtx: Omit<ToolContext, "strict">,
): void {
  const ctx: ToolContext = { ...baseCtx, strict: false };
  const canWrite = ctx.scopes.includes(WRITE_SCOPE);
  const canRead = canWrite || ctx.scopes.includes(READ_SCOPE);

  for (const tool of tools) {
    if (tool.scope === "write" && !canWrite) continue;
    if (tool.scope === "read" && !canRead) continue;

    server.registerTool(
      tool.name,
      {
        title: tool.title,
        description: tool.description,
        inputSchema: tool.input,
        annotations: {
          title: tool.title,
          readOnlyHint: tool.scope === "read",
          openWorldHint: false,
          ...tool.annotations,
        },
      },
      async (args: unknown) => {
        const start = Date.now();
        const attrs = {
          "mcp.tool": tool.name,
          "mcp.client_id": ctx.clientId,
          "enduser.id": ctx.userId,
        };
        try {
          const out = await withSpan(`mcp.tool.${tool.name}`, attrs, () =>
            runWithWriteSource(
              { source: "mcp", clientId: ctx.clientId, clientName: ctx.clientName },
              () => tool.handler(args as never, { ...ctx, strict: tool.scope === "write" }),
            ),
          );
          log("info", `MCP tool ${tool.name} ok ${Date.now() - start}ms`, {
            operation: "mcp.tool",
            tool: tool.name,
            userId: ctx.userId,
            clientId: ctx.clientId,
            durationMs: Date.now() - start,
            outcome: "ok",
          });
          return okResult(out);
        } catch (err) {
          const expected = err instanceof ToolError;
          log(expected ? "info" : "error", `MCP tool ${tool.name} ${expected ? "rejected" : "failed"}`, {
            operation: "mcp.tool",
            tool: tool.name,
            userId: ctx.userId,
            clientId: ctx.clientId,
            durationMs: Date.now() - start,
            outcome: expected ? "rejected" : "error",
            error: err instanceof Error ? err.message : String(err),
          });
          if (expected) return errorResult(err.message, err.details);
          return errorResult("Something went wrong on Tab's side. Try again in a moment.");
        }
      },
    );
  }
}
