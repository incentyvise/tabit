import { betterAuth } from "better-auth";
import { createFullId, parseCorsOrigins } from "shared";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { emailOTP, admin } from "better-auth/plugins";
import { APIError, createAuthMiddleware, getSessionFromCtx } from "better-auth/api";
import { SequenzyClient } from "sequenzy";
import { db, user, session, account, verification } from "db";
import { debug, log } from "otel";
import { sendDiscordWebhook } from "shared";

const appName = process.env.APP_NAME ?? "Tab";
const sequenzyApiKey = process.env.SEQUENZY_API_KEY;
const sequenzy = sequenzyApiKey ? new SequenzyClient({ apiKey: sequenzyApiKey }) : null;

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

async function sendEmail(
  client: SequenzyClient,
  opts: { to: string; subject: string; text: string },
): Promise<void> {
  await client.transactional.send({
    to: opts.to,
    subject: opts.subject,
    body: escapeHtml(opts.text).replace(/\n/g, "<br>"),
    idempotencyKey: crypto.randomUUID(),
  });
}

function emailDomain(email: string): string {
  const at = email.lastIndexOf("@");
  return at >= 0 ? email.slice(at + 1) : "unknown";
}

function logOtpToConsole(type: string, email: string, otp: string): void {
  debug(`Auth OTP ${type} *@${emailDomain(email)}: ${otp}`, { authType: type });
}

/** Emails allowed to hold the admin role (ADMIN_EMAILS, comma-separated). */
export function getAdminEmails(): Set<string> {
  return new Set(
    (process.env.ADMIN_EMAILS ?? "")
      .split(",")
      .map((e) => e.trim().toLowerCase())
      .filter(Boolean),
  );
}

export function isAllowlistedAdmin(email: string | null | undefined): boolean {
  return !!email && getAdminEmails().has(email.toLowerCase());
}

export const auth = betterAuth({
  secret: process.env.BETTER_AUTH_SECRET,
  session: {
    expiresIn: 60 * 60 * 24 * 365,
  },
  user: {
    additionalFields: {
      username: {
        type: "string",
        required: false,
        defaultValue: null,
        input: true,
      },
      defaultCurrency: {
        type: "string",
        required: false,
        defaultValue: null,
        input: true,
      },
    },
  },
  database: drizzleAdapter(db, {
    provider: "pg",
    schema: {
      user,
      session,
      account,
      verification,
    },
  }),
  databaseHooks: {
    user: {
      create: {
        after: async (user) => {
          const content = [`New user: ${user.email}`].join("\n");
          sendDiscordWebhook(content);
        },
      },
    },
  },
  advanced: {
    database: {
      generateId: () => createFullId(),
    },
    ...(process.env.BETTER_AUTH_COOKIE_DOMAIN && {
      crossSubDomainCookies: {
        enabled: true,
        domain: process.env.BETTER_AUTH_COOKIE_DOMAIN,
      },
    }),
  },
  hooks: {
    // Better Auth admin endpoints (ban, impersonate, revoke) require an allowlisted admin,
    // not just role=admin on the user row.
    before: createAuthMiddleware(async (ctx) => {
      if (!ctx.path.startsWith("/admin/") || ctx.path === "/admin/stop-impersonating") {
        return;
      }
      const session = await getSessionFromCtx(ctx);
      const sessionWithImpersonation = session?.session as
        | { impersonatedBy?: string | null }
        | undefined;
      if (
        !session ||
        sessionWithImpersonation?.impersonatedBy ||
        !isAllowlistedAdmin(session.user.email)
      ) {
        throw new APIError("FORBIDDEN", { message: "Admin access required" });
      }
    }),
  },
  emailAndPassword: {
    enabled: false,
  },
  plugins: [
    admin({
      defaultRole: "user",
      adminRoles: ["admin"],
      impersonationSessionDuration: 60 * 60,
    }),
    emailOTP({
      sendVerificationOTP: async ({ email, otp, type }) => {
        const send = async () => {
          if (type === "sign-in") {
            if (sequenzy) {
              await sendEmail(sequenzy, {
                to: email,
                subject: `Sign in to ${appName}: ${otp}`,
                text: `Your sign-in code for ${appName} is: ${otp}\n\nThis code expires in 5 minutes.`,
              });
            } else {
              logOtpToConsole(type, email, otp);
            }
          } else if (type === "email-verification") {
            if (sequenzy) {
              await sendEmail(sequenzy, {
                to: email,
                subject: `Verify your email for ${appName}: ${otp}`,
                text: `Your verification code for ${appName} is: ${otp}\n\nThis code expires in 5 minutes.`,
              });
            } else {
              logOtpToConsole(type, email, otp);
            }
          } else {
            if (sequenzy) {
              await sendEmail(sequenzy, {
                to: email,
                subject: `Reset your password for ${appName}`,
                text: `Your password reset code for ${appName} is: ${otp}\n\nThis code expires in 5 minutes.`,
              });
            } else {
              logOtpToConsole(type, email, otp);
            }
          }
        };
        try {
          await send();
        } catch (err) {
          log("error", "Failed to send OTP email", {
            authType: type,
            emailDomain: emailDomain(email),
            error: err instanceof Error ? err.message : String(err),
          });
          logOtpToConsole(type, email, otp);
        }
      },
      expiresIn: 60 * 5,
    }),
  ],
  baseURL:
    process.env.VITE_API_URL ??
    process.env.VITE_BACKEND_URL ??
    "http://localhost:3001",
  trustedOrigins: parseCorsOrigins(
    process.env.NEXT_PUBLIC_PWA_URL,
    process.env.BETTER_AUTH_TRUSTED_ORIGINS,
    process.env.CORS_ORIGIN,
    process.env.NEXT_PUBLIC_ADMIN_URL,
    "https://app.tabit.in",
    "https://admin.tabit.in",
    "https://wrk.tabit.in",
    "https://localhost:3003",
    "http://localhost:3003",
    "https://localhost:3004",
    "http://localhost:3004",
  ),
});
