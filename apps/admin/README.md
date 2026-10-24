# Tab Admin

Internal admin console for Tab. Vite + React 19 + TanStack Router/Query SPA on port **3004**
(`admin.tabit.in` in prod). Talks to the existing API (`/rpc/admin.*` and Better Auth `/api/auth/admin/*`).

## Access model

- **Sign-in:** email OTP only (Better Auth `emailOTP`), same flow as the PWA.
- **Admin = role + allowlist.** Better Auth `admin` plugin stores `user.role`; a user is an admin only when
  `role === "admin"` **and** their email is in `ADMIN_EMAILS` (comma-separated, API env).
  - `requireAdmin` (oRPC middleware) promotes allowlisted users to `role=admin` on first admin call and
    rejects everyone else (403), including role=admin users that were removed from the allowlist.
  - A Better Auth `hooks.before` guard rejects `/admin/*` auth endpoints for non-allowlisted callers, so the
    plugin's own ban/impersonate/revoke endpoints can't be reached by a stray role=admin row.
  - Impersonation sessions (`session.impersonatedBy`) never pass `requireAdmin`.
- Non-admins who sign in on the admin app are told so and signed out.

## Pages

| Route | Purpose |
| --- | --- |
| `/login` | Email → 6-digit OTP |
| `/` Overview | KPIs (users, new 1/7/30d, active 7/30d, tabs, expenses, settlements, push subs, AI calls 7d), daily charts (signups, expenses, active users; 30/90/180d), activation funnel, recent signups |
| `/users` | Search email/name/username, filter (all/admins/banned), sort, paginate. Columns: user, joined, last seen, tabs, expenses, status |
| `/users/$userId` | Profile + role/ban state, stats, tabs, sessions (IP/UA/expiry/impersonated) with revoke one/all, API keys with revoke, push subscriptions, preferences, recent audit activity, AI usage. Actions: **ban** (reason + duration) / **unban**, **revoke sessions**, **impersonate** |
| `/tabs` | Search, filter direct/group, sort. Members, expenses, volume, last activity |
| `/tabs/$tabId` | Members + placeholder participants (merged state), expenses (incl. deleted), settlements, recurring rules, pending invites, combined audit timeline |
| `/expenses` | Global expense search (description), include-deleted, per-tab/user filters; row expands to splits + audit history |
| `/audit` | Audit explorer across `expense_audit_log`, `settlement_audit_log`, `tab_event`: filter by source, action, user, tab, date range |
| `/recurring` | Rule counts by status, needs-fix + overdue rules, recent occurrences, FX snapshots + freshness |
| `/queue` | BullMQ `notifications` queue counts, failed jobs (error, attempts, payload type) with **retry**, push subscription stats (total, users, browser breakdown) |
| `/ai` | AI voice expense usage: calls/day, outcome breakdown, tokens, latency p50/p95, top users, recent calls (from new `ai_usage_event` table) |
| `/system` | Health of DB / Redis / workers, API uptime + versions, applied migrations, table row counts and sizes |

Global: sidebar nav, ⌘K-free search box on lists, light/dark theme, impersonation banner
("You are impersonating X — Open app / Stop") when the current session is an impersonation.

## Backend changes

- `packages/db`: admin plugin columns (`user.role/banned/banReason/banExpires`, `session.impersonatedBy`),
  new `ai_usage_event` table, migration.
- `packages/auth`: `admin()` plugin, allowlist helpers, `/admin/*` guard, admin origin in trusted origins.
- `packages/data/src/admin.ts`: read-only admin queries.
- `packages/rpc/src/procedures/admin.ts`: `requireAdmin` + `admin.*` router (reads, retry job, revoke API key).
  Ban/unban/session revoke/impersonate go through Better Auth admin endpoints from the client.
- `packages/rpc/src/procedures/ai.ts`: records an `ai_usage_event` per call.
- `packages/shared` CORS + compose/Dockerfile for the admin app.

## Env

| Var | Where | Notes |
| --- | --- | --- |
| `ADMIN_EMAILS` | api | Required. Comma-separated allowlist |
| `NEXT_PUBLIC_ADMIN_URL` | api, admin build | e.g. `https://admin.tabit.in`; added to CORS + trusted origins |
| `VITE_API_URL` | admin build | API base; dev uses the Vite proxy when unset |
| `NEXT_PUBLIC_PWA_URL` | admin build | Target for "Open app" while impersonating |
| `WORKERS_HEALTH_URL` | api | Optional, e.g. `http://workers:3002/health` for `/system` |

## Dev

```bash
pnpm --filter=admin dev
```
