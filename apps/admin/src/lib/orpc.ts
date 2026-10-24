import { createORPCClient } from "@orpc/client";
import { RPCLink } from "@orpc/client/fetch";
import type { RouterClient } from "@orpc/server";
import { createRouterUtils } from "@orpc/tanstack-query";
import type { AppRouter } from "rpc";
import { apiBaseUrl } from "./config";

const link = new RPCLink({
  url: `${apiBaseUrl || window.location.origin}/rpc`,
  fetch: (request, init) => globalThis.fetch(request, { ...init, credentials: "include" }),
});

const client: RouterClient<AppRouter> = createORPCClient(link);

/** Admin procedures only; the rest of the app router is irrelevant here. */
export const adminRpc = client.admin;
export const orpc = createRouterUtils(client).admin;
