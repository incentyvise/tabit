CREATE TABLE "ai_usage_event" (
	"id" text PRIMARY KEY NOT NULL,
	"userId" text NOT NULL,
	"feature" text NOT NULL,
	"outcome" text NOT NULL,
	"model" text NOT NULL,
	"inputChars" integer NOT NULL,
	"inputTokens" integer,
	"outputTokens" integer,
	"latencyMs" integer NOT NULL,
	"confidence" numeric(4, 3),
	"expenseId" text,
	"errorMessage" text,
	"createdAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "session" ADD COLUMN "impersonatedBy" text;--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN "role" text;--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN "banned" boolean DEFAULT false;--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN "banReason" text;--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN "banExpires" timestamp;--> statement-breakpoint
ALTER TABLE "ai_usage_event" ADD CONSTRAINT "ai_usage_event_userId_user_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ai_usage_event_createdAt_idx" ON "ai_usage_event" USING btree ("createdAt");--> statement-breakpoint
CREATE INDEX "ai_usage_event_userId_createdAt_idx" ON "ai_usage_event" USING btree ("userId","createdAt");