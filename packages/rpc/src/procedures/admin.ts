import { z } from "zod";
import { ORPCError } from "@orpc/server";
import { auth, isAllowlistedAdmin } from "auth";
import { admin as adminData } from "data";
import { getNotificationsQueue } from "queue";
import { base } from "../auth-middleware.js";

const API_STARTED_AT = new Date();

/**
 * Admin = Better Auth role "admin" AND email in ADMIN_EMAILS. Allowlisted users are promoted on first use;
 * role=admin users no longer on the allowlist are demoted. Impersonation sessions never pass.
 */
const requireAdmin = base.middleware(async ({ context, next }) => {
  const session = await auth.api.getSession({ headers: context.headers });
  if (!session?.user) {
    throw new ORPCError("UNAUTHORIZED", { message: "Unauthorized" });
  }
  if (session.session.impersonatedBy) {
    throw new ORPCError("FORBIDDEN", { message: "Stop impersonating to use the admin console" });
  }
  const allowlisted = isAllowlistedAdmin(session.user.email);
  if (!allowlisted) {
    if (session.user.role === "admin") await adminData.setRole(session.user.id, "user");
    throw new ORPCError("FORBIDDEN", { message: "Admin access required" });
  }
  if (session.user.role !== "admin") {
    await adminData.setRole(session.user.id, "admin");
  }
  return next({ context: { ...context, userId: session.user.id } });
});

const adminProc = base.use(requireAdmin);

const pageInput = {
  limit: z.number().int().min(1).max(200).default(50),
  offset: z.number().int().min(0).default(0),
};

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return Promise.race([
    promise,
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms),
    ),
  ]);
}

async function fetchWithTimeout(url: string, ms: number) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  const start = Date.now();
  try {
    const res = await fetch(url, { signal: controller.signal });
    return { ok: res.ok, status: res.status, latencyMs: Date.now() - start };
  } catch (err) {
    return { ok: false, status: 0, latencyMs: Date.now() - start, error: String(err) };
  } finally {
    clearTimeout(timer);
  }
}

export const adminProcedures = {
  me: adminProc.handler(async ({ context }) => {
    const session = await auth.api.getSession({ headers: context.headers });
    return {
      id: session!.user.id,
      email: session!.user.email,
      name: session!.user.name,
    };
  }),

  overview: adminProc.handler(() => adminData.overview()),

  timeseries: adminProc
    .input(z.object({ days: z.number().int().min(7).max(365).default(30) }))
    .handler(({ input }) => adminData.timeseries(input.days)),

  users: {
    list: adminProc
      .input(
        z.object({
          search: z.string().trim().optional(),
          filter: z.enum(["all", "admins", "banned"]).default("all"),
          sort: z.enum(["createdAt", "lastSeenAt", "expenseCount", "name"]).default("createdAt"),
          ...pageInput,
        }),
      )
      .handler(({ input }) => adminData.listUsers(input)),

    get: adminProc
      .input(z.object({ userId: z.string() }))
      .handler(async ({ input }) => {
        const data = await adminData.getUser(input.userId);
        if (!data) throw new ORPCError("NOT_FOUND", { message: "User not found" });
        const isAdmin = isAllowlistedAdmin(data.user.email);
        // Heal stale roles so Better Auth's own admin checks (e.g. impersonation) match the allowlist.
        if (!isAdmin && data.user.role === "admin") {
          await adminData.setRole(data.user.id, "user");
          data.user.role = "user";
        }
        return { ...data, isAdmin };
      }),

    revokeSession: adminProc
      .input(z.object({ sessionId: z.string() }))
      .handler(async ({ context, input }) => {
        const row = await adminData.getSessionToken(input.sessionId);
        if (!row) throw new ORPCError("NOT_FOUND", { message: "Session not found" });
        await auth.api.revokeUserSession({
          body: { sessionToken: row.token },
          headers: context.headers,
        });
        return { ok: true };
      }),

    revokeApiKey: adminProc
      .input(z.object({ apiKeyId: z.string() }))
      .handler(async ({ input }) => {
        const deleted = await adminData.deleteApiKey(input.apiKeyId);
        if (!deleted) throw new ORPCError("NOT_FOUND", { message: "API key not found" });
        return { ok: true };
      }),
  },

  tabs: {
    list: adminProc
      .input(
        z.object({
          search: z.string().trim().optional(),
          type: z.enum(["all", "group", "direct"]).default("all"),
          sort: z.enum(["createdAt", "lastActivityAt", "expenseCount", "volume"]).default("createdAt"),
          ...pageInput,
        }),
      )
      .handler(({ input }) => adminData.listTabs(input)),

    get: adminProc
      .input(z.object({ tabId: z.string() }))
      .handler(async ({ input }) => {
        const data = await adminData.getTab(input.tabId);
        if (!data) throw new ORPCError("NOT_FOUND", { message: "Tab not found" });
        return data;
      }),
  },

  expenses: {
    list: adminProc
      .input(
        z.object({
          search: z.string().trim().optional(),
          tabId: z.string().optional(),
          userId: z.string().optional(),
          includeDeleted: z.boolean().default(false),
          ...pageInput,
        }),
      )
      .handler(({ input }) => adminData.listExpenses(input)),

    get: adminProc
      .input(z.object({ expenseId: z.string() }))
      .handler(async ({ input }) => {
        const data = await adminData.getExpense(input.expenseId);
        if (!data) throw new ORPCError("NOT_FOUND", { message: "Expense not found" });
        return data;
      }),
  },

  audit: {
    list: adminProc
      .input(
        z.object({
          source: z.enum(["expense", "settlement", "tab"]).optional(),
          action: z.string().optional(),
          userId: z.string().optional(),
          tabId: z.string().optional(),
          from: z.coerce.date().optional(),
          to: z.coerce.date().optional(),
          ...pageInput,
        }),
      )
      .handler(({ input }) => adminData.audit(input)),

    actions: adminProc.handler(() => adminData.auditActions()),
  },

  recurring: adminProc.handler(() => adminData.recurring()),

  queue: {
    overview: adminProc.handler(async () => {
      const queue = getNotificationsQueue();
      const [redis, push] = await Promise.all([
        withTimeout(
          Promise.all([
            queue.getJobCounts("waiting", "active", "completed", "failed", "delayed", "paused"),
            queue.getJobs(["failed"], 0, 49),
            queue.isPaused(),
          ]),
          5000,
          "Redis",
        ).then(
          ([counts, failed, isPaused]) => ({ counts, failed, isPaused, error: null }),
          (err: unknown) => ({ counts: null, failed: [], isPaused: false, error: String(err) }),
        ),
        adminData.pushStats(),
      ]);
      return {
        counts: redis.counts,
        isPaused: redis.isPaused,
        queueError: redis.error,
        failed: redis.failed.map((job) => ({
          id: job.id ?? "",
          userId: job.data.userId,
          type: job.data.payload.type,
          attemptsMade: job.attemptsMade,
          failedReason: job.failedReason,
          timestamp: job.timestamp,
          finishedOn: job.finishedOn ?? null,
        })),
        push,
      };
    }),

    retry: adminProc
      .input(z.object({ jobId: z.string() }))
      .handler(async ({ input }) => {
        const job = await getNotificationsQueue().getJob(input.jobId);
        if (!job) throw new ORPCError("NOT_FOUND", { message: "Job not found" });
        await job.retry("failed");
        return { ok: true };
      }),
  },

  ai: adminProc
    .input(z.object({ days: z.number().int().min(1).max(365).default(30) }))
    .handler(({ input }) => adminData.aiUsage(input.days)),

  system: adminProc.handler(async () => {
    const workersUrl = process.env.WORKERS_HEALTH_URL;
    const redisStart = Date.now();
    const redis = await (async () => {
      try {
        // IRedisClient omits ping in its typings; the underlying ioredis client has it.
        await withTimeout(
          (async () => {
            const client = (await getNotificationsQueue().client) as unknown as { ping(): Promise<string> };
            await client.ping();
          })(),
          3000,
          "Redis ping",
        );
        return { ok: true, latencyMs: Date.now() - redisStart };
      } catch (err) {
        return { ok: false, latencyMs: Date.now() - redisStart, error: String(err) };
      }
    })();
    const [database, workers] = await Promise.all([
      adminData.system().then(
        (d) => ({ ok: true as const, ...d }),
        (err) => ({ ok: false as const, error: String(err) }),
      ),
      workersUrl ? fetchWithTimeout(workersUrl, 3000) : Promise.resolve(null),
    ]);
    const mem = process.memoryUsage();
    return {
      api: {
        startedAt: API_STARTED_AT,
        uptimeSeconds: Math.round(process.uptime()),
        nodeVersion: process.version,
        env: process.env.NODE_ENV ?? "development",
        rssMb: Math.round(mem.rss / 1024 / 1024),
        heapUsedMb: Math.round(mem.heapUsed / 1024 / 1024),
      },
      database,
      redis,
      workers,
    };
  }),
};
