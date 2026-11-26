# Plan: Tab MCP server (2026-11)

Goal: let a user connect Tab to Claude (claude.ai, Desktop, Code), ChatGPT, Cursor, etc. and manage tabs, expenses, settlements, friends and recurring expenses in conversation.

Status: **implemented on branch `t3/mcp-server-audit-plan`** (all phases; decisions in §8). Remaining work is listed in §0.

## 0. Implementation status

| Area | Where | Notes |
|---|---|---|
| Better Auth 1.7.28, drizzle-orm 0.45.4 | `package.json`s | `better-call>zod` pnpm override keeps one zod-4 copy of better-call (needed for `auth` d.ts emit). |
| OAuth server (`jwt` + `mcp` + `cimd`) | `packages/auth/src/index.ts`, `mcp-config.ts` | DCR on (most clients still use it), CIMD on, `refreshTokenReuseInterval: 0`, `/token` disabled. |
| OAuth tables + source columns, `api_key` dropped | `packages/db/src/schema/oauth.ts`, migrations `0024`, `0025` | |
| `/mcp`, `/.well-known/*`, open CORS for token-side OAuth endpoints | `apps/api/src/mcp.ts`, `index.ts` | Stateless SDK v2 handler, `legacy: "stateless"`. Consent re-checked per request (instant revoke), banned users 403, Redis rate limit per user. |
| 30 tools | `packages/mcp/src/tools/*` | Name resolution with ambiguity errors (`resolve.ts`); `invite_to_tab` (invite by username, needs acceptance) instead of adding members directly. |
| "via MCP · client" | `packages/data/src/write-source.ts` (AsyncLocalStorage), audit/activity reads, notification payload + push copy, PWA badges | |
| Poke/reminder cooldown | `packages/services/src/friend.ts`, `packages/queue/src/rate-limit.ts` | 10 min / 24 h per friend, 30/day per sender; applies to the PWA too. Fails open if Redis is down. |
| PWA login resume, `/oauth/consent`, Profile → Connected apps | `apps/pwa/lib/oauth-flow.ts`, `app/oauth/consent`, `app/(app)/me/connected-apps-section.tsx` | OAuth client plugin vendored (avoids zod 4 in the PWA). |
| Admin: API keys → Connected apps (revoke) | `apps/admin`, `packages/rpc/src/procedures/admin.ts` | |
| Tests | `packages/mcp/src/server.test.ts`, `packages/services/src/friend.test.ts` | Plus a scripted end-to-end run against real Postgres: discovery → DCR → OTP sign-in → authorize → consent → token → tool calls → revoke. |

**Still to do / verify before release**
- Try the hosted flow with real clients (claude.ai connector, Claude Code, ChatGPT, Cursor), especially the cross-subdomain cookie path `app.tabit.in` → `api.tabit.in`.
- Visual pass on the consent page and Connected apps section (built and type-checked, not yet clicked through in a browser).
- Run migrations `0024`/`0025` on staging. `0024` drops the unused `api_key` table.
- Operational: OAuth signing keys (`jwks`) are encrypted with `BETTER_AUTH_SECRET`. Rotating the secret requires clearing `jwks`, and connected apps then need to reconnect.
- Optional later: prompts/resources (§4), idempotency keys on create tools, a "Connect to Claude" help page on the landing site.

Status legend (original plan below): 🔲 todo · decisions in §8

---

## 1. Audit summary

### What we have that helps

| Area | Finding | Implication |
|---|---|---|
| Layering | `apps/api` (Hono) → `packages/rpc` (oRPC procedures) → `packages/services` (domain, returns `Result<T>`) → `packages/data` (Drizzle). Services take `userId` explicitly and do all membership/permission checks. | MCP tools can call **services directly** with the token's `userId`. No business logic duplicated, no HTTP hop. |
| Side effects | `expenseService.create/update/delete/restore` and settlement methods publish notifications (realtime + web push) themselves. | Expenses added from Claude notify friends exactly like the PWA. No extra work. |
| Validation | `models` has `createExpenseSchema`, `recordSettlementSchema`, `createTabSchema`, etc. | Reuse for server-side validation inside tool handlers. |
| Debt simplification | `shared/simplify-debts.ts` (tested) is used client-side in the settle-up form. | Can power a "who should pay whom" tool server-side. |
| FX | `convertToTabCurrency` + Frankfurter cache. | `fx_preview` tool for free. |
| Observability | `withSpan` / `log` in `otel`, used by `withProcedureLog`. | Mirror for `mcp.tool.*` spans. |
| Session cookies | `crossSubDomainCookies` on `.tabit.in`, so `app.tabit.in` login is visible to `api.tabit.in`. | The OAuth authorize endpoint on the API sees the PWA session. Login/consent UI can live in the PWA. |

### Gaps and problems found

| # | Sev | Finding | Fix in this plan |
|---|---|---|---|
| G1 | Blocker | Auth is **cookie-session only** (`requireAuth` → `auth.api.getSession({ headers })`). No bearer-token path exists. | §3: Better Auth `@better-auth/mcp` OAuth server + `requireMcpAuth`. |
| G2 | Blocker | `better-auth@1.5.4`, `drizzle-orm@0.41.0`. MCP support now lives in `@better-auth/mcp` (Better Auth ≥ 1.7), which needs `drizzle-orm ^0.45.2`. The old `mcp` plugin in `better-auth/plugins` was removed in 1.7. | Phase 0 upgrade. |
| G3 | High | `api_key` table + `packages/data/src/api-key.ts` exist but are **dead code**: nothing reads them, `scopes` column unused, no UI. | Delete both (D2: OAuth only). Drop the table in the Phase 1 migration. |
| G4 | High | `expenses.create/update` and `recurringExpenses.createForTab/update` take `body: z.record(z.unknown())`. That's fine for the PWA but useless as a tool schema: the model gets no fields, types or descriptions. | MCP tools define explicit, described Zod input schemas and then validate with the `models` schemas. |
| G5 | High | Tools need IDs (`tabId`, `userId`, `participantId`), but users speak in names ("dinner with Sam", "Goa trip"). Friends are **direct tabs**, and placeholders are `tab_participant` rows with no `userId`. | Add a `resolve` step: list tools return IDs + names, `create_expense` accepts a friend username or tab name and resolves server-side, and returns candidates when ambiguous. |
| G6 | Medium | Percent/shares/custom splits only allow registered members. Placeholders work only in equal splits (`services/src/expense.ts` ~L103). | Document in the tool description so the model doesn't retry blindly. Return the service error verbatim. |
| G7 | Medium | No app-level rate limiting on `/rpc` (Better Auth only rate-limits its own routes, in memory). MCP adds automated, loop-prone clients. | Per-user + per-client Redis token bucket on `/mcp` (Redis already deployed). |
| G8 | Medium | Audit logs (`expense_audit_log`, `settlement_audit_log`) record `performedById` but not the *channel*. "Added via MCP · Claude" isn't representable. | Add `source` + client columns (§3.6). |
| G16 | Medium | `friendService.poke` / `sendPaymentReminder` have **no cooldown**. They push-notify the friend on every call, from the PWA today and from an agent loop tomorrow. | Server-side cooldown in the service (applies to the PWA too), §4. |
| G9 | Medium | PWA login only honours internal `callbackURL` (`safeInternalPath`). The OAuth flow sends the user to `loginPage?<signed oauth_query>` and must resume at the API afterwards. | Use `oauthProviderClient()` in the PWA auth client, which resumes the flow from `oauth_query`. Don't loosen `safeInternalPath`. |
| G10 | Medium | CORS on the API is an allowlist with credentials. Well-known metadata and `/mcp` must be reachable cross-origin (browser-based clients, MCP Inspector) **without** credentials. | Separate CORS policy for `/.well-known/*` and `/mcp`: `*`, no credentials, expose `WWW-Authenticate` + `Mcp-*` headers. |
| G11 | Medium | Hono only routes `/api/auth/*` to Better Auth. RFC 8414/9728 metadata must be at the **domain root** (`/.well-known/oauth-authorization-server/api/auth`, `/.well-known/oauth-protected-resource/mcp`). | Route `GET /.well-known/*` to `auth.handler`. |
| G12 | Low | Sessions last 1 year. OAuth access tokens must not inherit that. | Defaults: access 1h, refresh 30d rotating. |
| G13 | Low | `friends.search` and member payloads include other users' **emails**. Tool output goes to a third-party LLM provider. | MCP output DTOs omit other users' emails (name + username only). Disclose on the consent screen. |
| G14 | Low | `apps/pwa` depends on `@better-auth/drizzle-adapter` (a server package) for no apparent reason. | Remove during the upgrade. |
| G15 | Low | Self-hosters may run the PWA and API on unrelated domains with no shared cookie domain. Then the authorize endpoint can't see the PWA session. | MCP is **on by default** (`MCP_ENABLED=false` opts out). At startup, log a warning if the PWA and API origins differ and `BETTER_AUTH_COOKIE_DOMAIN` is unset. Document the requirement in the README. |

---

## 2. Architecture

```
Claude / ChatGPT / Cursor
   │  1. POST /mcp (no token) → 401 + WWW-Authenticate: resource_metadata=…
   │  2. GET /.well-known/oauth-protected-resource/mcp   (served by mcp() plugin)
   │  3. GET /.well-known/oauth-authorization-server/api/auth
   │  4. client identity: CIMD URL (2026 spec) or DCR /api/auth/oauth2/register (fallback)
   │  5. browser → api.tabit.in/api/auth/oauth2/authorize
   │        → app.tabit.in/login?oauth_query=…  (OTP sign-in, existing UI)
   │        → app.tabit.in/oauth/consent?oauth_query=…  (new page)
   │        → redirect back to the client with a code
   │  6. POST /api/auth/oauth2/token (PKCE) → JWT access token (aud = https://api.tabit.in/mcp) + refresh token
   ▼
api.tabit.in  (apps/api, Hono)
   ├─ /api/auth/*            Better Auth (+ jwt, mcp, cimd plugins)
   ├─ /.well-known/*         → auth.handler
   ├─ /rpc/*                 unchanged (cookie sessions, PWA)
   └─ /mcp  ── requireMcpAuth(auth, …, { resource }) ── rate limit ── createMcpHandler(factory)
                                                                         │
                                                         packages/mcp: tools → services/data
```

Decisions baked in (change via §8 if you disagree):

- **Host the MCP endpoint inside `apps/api` at `https://api.tabit.in/mcp`.** Same process as the auth server, so `requireMcpAuth` verifies JWTs in-process. No new container or domain. Self-hosters get it for free.
- **New workspace package `packages/mcp`**: tool definitions, DTO mappers, the server factory. `apps/api` only mounts it. This keeps it testable with the SDK's in-memory client and reusable if we ever split it out.
- **Stateless Streamable HTTP**, MCP TS SDK **v2** (`@modelcontextprotocol/server` + `@modelcontextprotocol/hono`), `legacy: "stateless"` so 2025-spec clients keep working. No sessions means no sticky routing, which suits horizontal scaling.
- **Tools call `services` directly**, not oRPC. Services already own auth checks and side effects. The oRPC input shapes (`z.record`) are the wrong contract for an LLM anyway.

---

## 3. Auth (Better Auth)

### 3.1 Short answer on "does Better Auth have MCP integrations"

Yes. As of Better Auth 1.7 (latest 1.7.28):

- **`@better-auth/mcp`**: `mcp()` plugin (a preconfigured `oauthProvider`). Makes Better Auth an OAuth 2.1 authorization server: PKCE (S256, required), RFC 8414 + RFC 9728 metadata, RFC 8707 resource/audience binding, JWT access tokens (RFC 9068) via the `jwt()` plugin, rotating refresh tokens, consent records, introspection, revocation and optional DCR. It also exports `requireMcpAuth()` to guard the resource route.
- **`@better-auth/cimd`**: Client ID Metadata Documents, which the current MCP spec (2026-07-28) prefers over DCR (DCR is now deprecated but still widely used).
- **`@better-auth/api-key`**: optional personal access tokens.
- The old `mcp` plugin in `better-auth/plugins` (what most blog posts show, with `withMcpAuth`) and `oidcProvider` were **removed in 1.7**. Don't follow older guides.

### 3.2 Server config (`packages/auth/src/index.ts`)

```ts
import { jwt } from "better-auth/plugins";
import { mcp } from "@better-auth/mcp";
import { cimd } from "@better-auth/cimd";
import { fetchClientMetadataResource } from "@better-auth/cimd/node";

const MCP_RESOURCE = `${apiBaseUrl}/mcp`;           // https://api.tabit.in/mcp
const PWA_URL = process.env.NEXT_PUBLIC_PWA_URL;    // https://app.tabit.in

betterAuth({
  // …existing…
  disabledPaths: ["/token"],               // session JWTs must not share the access-token endpoint
  plugins: [
    admin(…), emailOTP(…),                 // existing
    jwt({ disableSettingJwtHeader: true }),
    mcp({
      loginPage: `${PWA_URL}/login`,       // absolute cross-origin URL: works per source, verify (spike)
      consentPage: `${PWA_URL}/oauth/consent`,
      resource: MCP_RESOURCE,
      scopes: ["openid", "profile", "offline_access", "tab:read", "tab:write"],
      allowDynamicClientRegistration: true,          // fallback until clients ship CIMD
      allowUnauthenticatedClientRegistration: true,
      clientRegistrationDefaultApplicationType: "infer",
      clientRegistrationDefaultScopes: ["tab:read", "tab:write", "offline_access"],
      // accessTokenExpiresIn: 3600 (default), refreshTokenExpiresIn: 30d (default)
    }),
    cimd({ fetchClientMetadataResource, metadataProfile: "mcp-2026-07-28" }),
  ],
});
```

Do **not** also register `oauthProvider()`; `mcp()` wraps it.

### 3.3 Scopes

| Scope | Grants |
|---|---|
| `tab:read` | All read tools. |
| `tab:write` | Create/update tools, plus delete/restore (all deletes are soft or reversible, see §4). |

Keep it to two scopes. Finer scopes (e.g. `tab:settle`) add consent friction without real safety gain. Per-call confirmation lives in the client, which is driven by tool annotations (`destructiveHint`).

### 3.4 PWA work

1. `apps/pwa/lib/auth-client.ts`: add `oauthProviderClient()` from `@better-auth/oauth-provider/client`. It carries `oauth_query` through sign-in and follows the resume redirect.
2. Login page: when `oauth_query` is present, don't apply the `callbackURL` → `/tabs` redirect after OTP. Let the plugin resume. Show "Sign in to connect **{client name}** to Tab" (`allowPublicClientPrelogin` exposes the client info before login).
3. New route `/oauth/consent`: client name/logo/URI (from CIMD/DCR metadata, clearly marked unverified), requested scopes in plain English, a note that tab data will be shared with the AI provider, and Allow/Deny → `authClient.oauth2.consent({ accept, scope })`.
4. New **Settings → Connected apps** on `/me`: list consents/clients, and revoke (Better Auth exposes list/update/delete consent endpoints and `/oauth2/revoke`).

### 3.5 OAuth only

No personal access tokens (D2). Claude Code, Desktop, claude.ai, ChatGPT and Cursor all run the OAuth flow themselves. Delete the dead `api_key` table and module (G3).

### 3.6 "Added via MCP · {client name}" (D6)

This is feasible. Every access token carries `azp` = the OAuth `client_id`. That resolves to an `oauthClient` row with the client's `name`, which comes from `client_name` in its CIMD document or DCR registration.

- **Schema:** add nullable columns to `expense_audit_log` and `settlement_audit_log`, and also `expense` / `settlement` / `recurring_expense_rule` so list rows can show a badge without joining audit logs:
  - `source` (`pwa` | `mcp` | `recurring` | `import`)
  - `sourceClientId` (FK → `oauthClient.id`, `ON DELETE SET NULL`)
  - `sourceClientName`: a **snapshot** taken at write time, so the label survives the client being deleted or renamed.
- **Plumbing:** services get an optional `actor?: { source; clientId?; clientName? }` argument, defaulting to `pwa`. The MCP layer builds it once per request from the token claims. The client name is looked up once and cached in-process for ~5 min.
- **Realtime/push:** include `actor` in the `expense_added` / `settlement_changed` payloads so the notification reads "Parth added ₹1,200 Dinner (via Claude)".
- **PWA:** expense/settlement detail and history show "Added via MCP · Claude". The activity feed gets a small badge.
- **Caveat: names are self-declared.** Any client can register as "Claude". Mitigations:
  - With CIMD the `client_id` *is* an HTTPS URL (e.g. `https://claude.ai/…`), so show the verified host next to the name: "Claude (claude.ai)".
  - For DCR clients, show the redirect-URI host, the same thing the consent page shows.
  - Optionally keep a small allowlist of known client_id hosts (claude.ai, chatgpt.com, cursor.com…) to render a ✓.

---

## 4. Tool catalogue (v1)

Conventions:
- Names are `snake_case` verbs. Every tool has a one-paragraph description written for the model, including when **not** to use it.
- Annotations: `readOnlyHint` on reads. `destructiveHint` on delete/remove. `idempotentHint` where true.
- Outputs are compact JSON (`structuredContent` + a short text summary). Money is `{ amount: number, currency: "INR" }` and always tab-currency-explicit. Dates are ISO `YYYY-MM-DD` in the user's timezone (`user.timezone`).
- No other users' emails in output (G13).
- Lists are paginated (`limit` ≤ 50, `cursor`/`offset`), with default sort newest first.

### Read (`tab:read`)

| Tool | Backed by | Notes |
|---|---|---|
| `get_me` | `user` data + preferences | id, name, username, default currency, timezone. |
| `get_overview` | `tab.getTabsForUser({ includeDirect, includeBalance })` | **The first tool most chats need.** Net position grouped by currency: owed to you, you owe, top friends/tabs by balance. |
| `list_tabs` | same | Group tabs: id, name, currency, member count, your balance, last activity. Optional `query` name filter. |
| `list_friends` | `friendService.getFriends` | Direct tabs: friendTabId, name, username, balance. |
| `get_tab` | `tabService.getWithMembers` | Members + placeholders (participantId, userId?, displayName, kind), currency. |
| `get_balances` | `tabService.getBalancesForTab` + `simplifyDebts` | Per-participant net, plus **suggested transfers** ("Sam pays you ₹420"). |
| `list_expenses` | `expenseService.getForTab` | tabId, filter (`all`/`involved`/`owed`/`owe`), search, limit/offset. Add a `since`/`until` date filter in `data/expense.ts` (small gap). |
| `get_expense` | `expenseService.getById` (+ `getAuditLog` with `includeHistory`) | Splits with names, payer, FX info. |
| `list_settlements` | `tabService.getSettlementsForTab` | |
| `list_recurring_expenses` | `recurringExpenseService.listForTab` | Schedule in words + next run date. |
| `get_activity` | `activity.getForUser` | Recent cross-tab feed. |
| `list_pending_requests` | `friendService.getPendingRequests` + `tabInviteService.getPendingRequests` | Incoming friend and tab requests. |
| `preview_currency_conversion` | `convertToTabCurrency` | Uses the same FX source the expense will use. |

### Write (`tab:write`)

| Tool | Backed by | Notes |
|---|---|---|
| `create_expense` | `expenseService.create` | Explicit schema: `target` (one of `tabId` / `friendUsername` / `tabName`), `amount`, `currency?`, `description`, `date?`, `paidBy?` (default me; username or participantId), `splitType`, `splits?`, `participants?`. Resolves names server-side. **Returns candidates instead of guessing** if ambiguous. Echoes the resolved split so the model can show it. |
| `update_expense` | `expenseService.update` | Fetch-merge-write: tool accepts partial fields, merges onto current state, validates with `createExpenseSchema`. |
| `delete_expense` | `expenseService.delete` | `destructiveHint`. Soft delete; the response mentions `restore_expense`. |
| `restore_expense` | `expenseService.restore` | |
| `record_settlement` | `settlementService.record` | `from`/`to` default sensibly ("I paid Sam back" → from me to Sam). Amount defaults to the outstanding balance when `settle_full: true`. |
| `update_settlement` / `delete_settlement` | settlement service | delete = `destructiveHint`. |
| `create_tab` | `tabService.create` | name, currency. |
| `update_tab` | `tabService.update` | rename / currency. |
| `add_tab_member` | `tabService.addMember` | By **friend username** (resolves to email server-side), so the model never needs emails. |
| `add_placeholder` | `tabService.createPlaceholder` | "Add Priya (not on Tab yet)". |
| `create_recurring_expense` / `update_recurring_expense` / `delete_recurring_expense` | `recurringExpenseService` | Explicit schedule schema (interval / monthly / weekly weekdays) and pause/resume. |
| `respond_to_request` | friend/tab-invite accept/reject | |
| `send_friend_request` | `friendService.sendRequest` | By username. |
| `poke_friend` | `friendService.poke` | `openWorldHint: true` (notifies another person). Subject to the cooldown below. |
| `send_payment_reminder` | `friendService.sendPaymentReminder` | Same. `tone` enum from `paymentReminderRequestSchema`. Only valid when the friend owes you; the service already enforces this. |

**Cooldown for poke/reminders (G16).** Add a Redis-backed cooldown inside `friendService`, so it covers the PWA too:
- one poke per friend per 10 min
- one payment reminder per friend per 24 h
- a per-sender daily cap

Return `429` with `retryAfter`, and have the tool say when the user can try again.

### Deliberately excluded from v1

- `admin.*`, `push.*`, `ai.addExpense` (the client LLM *is* the parser), `profile`/`username` edits.
- `createBulk` / CSV import: large payloads and a poor fit for chat. Maybe later as a resource-based import.
- `mergePlaceholder`, `removeMember`: irreversible ledger surgery. Keep in the PWA.

### Prompts and resources (phase 3, small)

- Prompts: `settle_up` ("help me settle up with {friend}"), `monthly_summary`, `split_receipt` (the user pastes or photographs a receipt and Claude itemises the split).
- Resource: `tab://currencies` (supported codes), `tab://tabs/{id}/ledger` (CSV export for analysis).

---

## 5. Implementation phases

### Phase 0: Upgrade (prerequisite, own PR)
1. 🔲 Bump `better-auth` and all `@better-auth/*` to the same `1.7.x`, and `drizzle-orm` to `^0.45.2` across `db`, `data`, `auth`, `admin`, `pwa`. Remove the stray `@better-auth/drizzle-adapter` from the PWA (G14).
2. 🔲 Read the 1.6 and 1.7 upgrade guides. Check `admin` and `emailOTP` behaviour changes, the `crossSubDomainCookies` and `trustedOrigins` semantics, and the `getSessionFromCtx` / `createAuthMiddleware` signatures used by the admin hook.
3. 🔲 `pnpm check && pnpm test`, then a manual smoke test: OTP login, admin impersonation, realtime (workers use session cookies).
4. 🔲 Ship and watch for a few days before Phase 1.

### Phase 1: OAuth server (own PR)
1. 🔲 Add `jwt()`, `mcp()`, `cimd()` (config §3.2). `npx auth@latest generate --adapter drizzle --dialect postgresql` → copy the new tables (`jwks`, `oauthClient`, `oauthAccessToken`, `oauthRefreshToken`, `oauthConsent`, `oauthClientAssertion`, `oauthResource`, `oauthClientResource`) into `packages/db/src/schema/auth.ts` → `pnpm db:generate` migration. IDs must use `createFullId` via the existing `generateId`.
2. 🔲 Hono: `app.get("/.well-known/*", c => auth.handler(c.req.raw))` with a permissive no-credentials CORS (G10, G11).
3. 🔲 PWA: `oauthProviderClient()`, login resume, `/oauth/consent` page (§3.4).
4. 🔲 **Spike first (½ day):** confirm absolute cross-origin `loginPage`/`consentPage` work and the signed `oauth_query` round-trips through OTP login. This is the riskiest unknown. Fallback: serve a minimal consent page from the API origin.
5. 🔲 Env: `MCP_ENABLED` (default **on**; `false` disables the `mcp()`/`cimd()` plugins, `/mcp` and the well-knowns). Add the cookie-domain startup warning (G15). Document both in `.env.example` + README.
6. 🔲 Drop the dead `api_key` table and `data/api-key.ts` (G3).

### Phase 2: MCP endpoint + read tools (own PR)
1. 🔲 `packages/mcp`: `createTabMcpServer(userId, scopes, clientId)` factory. A tool registration helper that wraps every handler with: a scope check, `withSpan("mcp.tool.<name>")`, structured logging (tool, userId, clientId, durationMs, outcome), and `Result` → MCP error mapping (`isError: true` with the service message; never throw raw).
2. 🔲 DTO mappers (strip emails, format money and dates).
3. 🔲 Name resolution helpers (`resolveTab`, `resolveFriend`, `resolveParticipant`) with fuzzy match + ambiguity results.
4. 🔲 Mount in `apps/api`: `requireMcpAuth(auth, handler, { resource: MCP_RESOURCE, requiredScopes: ["tab:read"] })` → rate limit (G7) → `createMcpHandler(factory, { legacy: "stateless", responseMode: "json" })`. Map `claims.sub` → userId, `claims.azp` → clientId. Reject banned users.
5. 🔲 All read tools from §4.
6. 🔲 Tests: SDK in-memory client against the factory with a seeded DB (follow the existing `services/*.test.ts` setup). Auth integration test: no token → 401 + `WWW-Authenticate`, wrong audience → 401, missing scope → 403 `insufficient_scope`.
7. 🔲 Manual: MCP Inspector, then Claude Code (`claude mcp add --transport http tab http://localhost:3001/mcp`), then claude.ai custom connector against staging.

### Phase 3: Write tools (own PR)
1. 🔲 Write tools from §4 with explicit schemas (G4), annotations, and ambiguity handling (G5).
2. 🔲 `source` / `sourceClientId` / `sourceClientName` columns + `actor` plumbing + realtime payloads + PWA "Added via MCP · {client}" label (§3.6, G8).
3. 🔲 Poke/reminder cooldown in `friendService` (G16), with tests.
4. 🔲 Idempotency: optional `idempotencyKey` on `create_expense` / `record_settlement` (Redis, 24h) so client retries don't double-post.
5. 🔲 Tests per tool: happy path, permission denied (other user's tab), ambiguity, placeholder split restriction (G6), cooldown.

### Phase 4: Polish & distribution
1. 🔲 PWA **Settings → Connected apps** (list + revoke) and a "Connect to Claude" help page with copy-paste instructions per client.
2. 🔲 Prompts/resources (§4).
3. 🔲 Landing page section + README "Use Tab from Claude".
4. 🔲 Dashboards/alerts: tool error rate, p95 latency, 401/403 rates, per-client volume.
5. 🔲 Optional later: submit to the Anthropic connector directory / ChatGPT apps once stable. That needs a privacy policy section covering AI clients.

Rough size: P0 1–2 days (mostly regression testing), P1 2–3 days, P2 2–3 days, P3 3–4 days, P4 2 days.

---

## 6. Security checklist

- Validate `aud` = `https://api.tabit.in/mcp`, `iss`, `exp`, `azp` (`requireMcpAuth` with explicit `resource`). Never accept session cookies on `/mcp`.
- `disabledPaths: ["/token"]` so session JWTs can't be replayed as access tokens (they share the JWKS).
- Every tool authorises via services' membership checks. Add tests that cross-user access returns 403/404 for each tool.
- CIMD fetch uses the SSRF-safe `@better-auth/cimd/node` fetcher.
- Consent page shows the client's redirect host. DCR-registered names are unverified, so label them that way.
- Rate limit per user and per client. Cap list sizes. Cap `description` lengths (schemas already do).
- Ban check: `user.banned` → 403, and revoke tokens on ban (admin hook).
- Tool output is untrusted to the *client*: expense descriptions written by other users can contain prompt-injection text. Keep descriptions in structured fields (not instruction-like prose), and never execute side effects based on description content.
- Logs: no tokens, no full emails (follow the existing `emailDomain()` pattern).

## 7. Testing matrix

| Client | Transport/auth | Check |
|---|---|---|
| MCP Inspector | HTTP + OAuth | Discovery, DCR/CIMD, all tools listed with schemas. |
| Claude Code | HTTP + OAuth (`/mcp` login) | End-to-end create expense → PWA receives realtime + push. |
| claude.ai / Desktop custom connector | HTTP + OAuth | Consent page, token refresh after 1h, revoke from Connected apps. |
| ChatGPT connector | HTTP + OAuth | Spec-era differences (2025 vs 2026), DCR fallback. |
| Cursor | HTTP + OAuth | |

## 8. Decisions (agreed 2026-11-26)

| # | Decision |
|---|---|
| D1 | MCP endpoint at `https://api.tabit.in/mcp`, inside `apps/api`. |
| D2 | OAuth only. No personal access tokens; the dead `api_key` code is removed. |
| D3 | Deletes (expense/settlement) are allowed in v1, marked `destructiveHint`. `removeMember`/`mergePlaceholder` stay PWA-only. |
| D4 | Poke and payment reminders are in v1, with a server-side cooldown (G16). |
| D5 | MCP is enabled by default, including for self-hosters (`MCP_ENABLED=false` opts out). |
| D6 | Writes are labelled "Added via MCP · {client name}" (§3.6). |
