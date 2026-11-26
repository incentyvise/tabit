import { AsyncLocalStorage } from "node:async_hooks";

/**
 * Who is writing on the user's behalf. Unset = the Tab app itself. The MCP
 * server wraps each tool call in `runWithWriteSource` so every expense,
 * settlement, recurring rule and audit-log row written during that call is
 * stamped "via MCP · <client>" without threading an argument through every
 * service and data function.
 */
export type WriteSource = {
  source: "mcp";
  clientId: string;
  clientName: string;
};

const storage = new AsyncLocalStorage<WriteSource>();

export function runWithWriteSource<T>(source: WriteSource, fn: () => T): T {
  return storage.run(source, fn);
}

export function currentWriteSource(): WriteSource | null {
  return storage.getStore() ?? null;
}

/** Column values for the `source*` columns on ledger and audit tables. */
export function writeSourceColumns(): {
  source: string | null;
  sourceClientId: string | null;
  sourceClientName: string | null;
} {
  const s = storage.getStore();
  return {
    source: s?.source ?? null,
    sourceClientId: s?.clientId ?? null,
    sourceClientName: s?.clientName ?? null,
  };
}
