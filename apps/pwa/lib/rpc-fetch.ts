/**
 * Minimal oRPC-over-HTTP client for the service worker (no orpc client bundle).
 * Mirrors @orpc/client's RPCLink wire format: POST {rpcUrl}/{...path} with a
 * `{ json, meta }` body; responses are `{ json, meta }` too. Only plain-JSON
 * inputs/outputs are supported (no Date/BigInt/Map meta decoding).
 */

function getApiBase(): string {
  const base = import.meta.env.VITE_API_URL ?? "";
  if (!base) return "";
  return base.replace(/\/$/, "");
}

function getRpcUrl(): string {
  const base = getApiBase();
  return base ? `${base}/rpc` : "/rpc";
}

export class RpcHttpError extends Error {
  readonly status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = "RpcHttpError";
    this.status = status;
  }
}

export async function rpcCall<T>(procedure: string[], input?: unknown): Promise<T> {
  const url = `${getRpcUrl()}/${procedure.map(encodeURIComponent).join("/")}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify({ json: input ?? null, meta: [] }),
  });
  const body = (await res.json().catch(() => null)) as {
    json?: unknown;
  } | null;
  if (!res.ok) {
    const message =
      (body?.json as { message?: string } | undefined)?.message ??
      `RPC failed: ${res.status}`;
    throw new RpcHttpError(message, res.status);
  }
  return (body && typeof body === "object" && "json" in body
    ? body.json
    : body) as T;
}

export function getApiUrlForSw(): string {
  return getApiBase() || "";
}
