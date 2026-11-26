import type { Result } from "services";

/** Who is calling: the Tab user behind the access token and the MCP client acting for them. */
export type McpUserContext = {
  userId: string;
  /** OAuth client_id of the MCP client. */
  clientId: string;
  /** Display name of the MCP client, e.g. "Claude". */
  clientName: string;
  /** Scopes granted to the access token. */
  scopes: readonly string[];
};

export const READ_SCOPE = "tab:read";
export const WRITE_SCOPE = "tab:write";

/**
 * An error the model should see and can act on (bad input, ambiguity, not
 * found). Thrown from tool handlers and returned as an `isError` tool result.
 */
export class ToolError extends Error {
  constructor(
    message: string,
    readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "ToolError";
  }
}

/** Unwraps a service `Result`, turning failures into a `ToolError` with the service's message. */
export function unwrap<T>(result: Result<T>): T {
  if (!result.success) {
    const status = result.status;
    const prefix =
      status === 403
        ? "Not allowed: "
        : status === 404
          ? "Not found: "
          : status === 429
            ? "Rate limited: "
            : "";
    throw new ToolError(`${prefix}${String(result.error)}`, { status });
  }
  return result.data;
}
