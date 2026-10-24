import {
  pgTable,
  text,
  boolean,
  timestamp,
  primaryKey,
} from "drizzle-orm/pg-core";
import { createFullId } from "shared";

export const user = pgTable("user", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => createFullId()),
  name: text("name"),
  username: text("username").unique(),
  email: text("email").notNull().unique(),
  emailVerified: boolean("emailVerified").notNull().default(false),
  image: text("image"),
  defaultCurrency: text("defaultCurrency"),
  /** IANA timezone for recurring schedules and calendar UX (e.g. America/Los_Angeles). */
  timezone: text("timezone"),
  /** Better Auth admin plugin: "admin" | "user". */
  role: text("role"),
  banned: boolean("banned").default(false),
  banReason: text("banReason"),
  banExpires: timestamp("banExpires"),
  createdAt: timestamp("createdAt").notNull().defaultNow(),
  updatedAt: timestamp("updatedAt").notNull().defaultNow(),
});

export const session = pgTable("session", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => createFullId()),
  userId: text("userId")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  token: text("token").notNull().unique(),
  expiresAt: timestamp("expiresAt").notNull(),
  ipAddress: text("ipAddress"),
  userAgent: text("userAgent"),
  /** Admin user id when this session is an admin impersonation. */
  impersonatedBy: text("impersonatedBy"),
  createdAt: timestamp("createdAt").notNull().defaultNow(),
  updatedAt: timestamp("updatedAt").notNull().defaultNow(),
});

export const account = pgTable("account", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => createFullId()),
  userId: text("userId")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  accountId: text("accountId").notNull(),
  providerId: text("providerId").notNull(),
  accessToken: text("accessToken"),
  refreshToken: text("refreshToken"),
  accessTokenExpiresAt: timestamp("accessTokenExpiresAt"),
  refreshTokenExpiresAt: timestamp("refreshTokenExpiresAt"),
  scope: text("scope"),
  idToken: text("idToken"),
  password: text("password"),
  createdAt: timestamp("createdAt").notNull().defaultNow(),
  updatedAt: timestamp("updatedAt").notNull().defaultNow(),
});

export const verification = pgTable("verification", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => createFullId()),
  identifier: text("identifier").notNull(),
  value: text("value").notNull(),
  expiresAt: timestamp("expiresAt").notNull(),
  createdAt: timestamp("createdAt").notNull().defaultNow(),
  updatedAt: timestamp("updatedAt").notNull().defaultNow(),
});
