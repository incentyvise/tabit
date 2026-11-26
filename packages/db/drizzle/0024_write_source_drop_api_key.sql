DROP TABLE "api_key" CASCADE;--> statement-breakpoint
ALTER TABLE "expense" ADD COLUMN "source" text;--> statement-breakpoint
ALTER TABLE "expense" ADD COLUMN "sourceClientId" text;--> statement-breakpoint
ALTER TABLE "expense" ADD COLUMN "sourceClientName" text;--> statement-breakpoint
ALTER TABLE "expense_audit_log" ADD COLUMN "source" text;--> statement-breakpoint
ALTER TABLE "expense_audit_log" ADD COLUMN "sourceClientId" text;--> statement-breakpoint
ALTER TABLE "expense_audit_log" ADD COLUMN "sourceClientName" text;--> statement-breakpoint
ALTER TABLE "recurring_expense_rule" ADD COLUMN "source" text;--> statement-breakpoint
ALTER TABLE "recurring_expense_rule" ADD COLUMN "sourceClientId" text;--> statement-breakpoint
ALTER TABLE "recurring_expense_rule" ADD COLUMN "sourceClientName" text;--> statement-breakpoint
ALTER TABLE "settlement" ADD COLUMN "source" text;--> statement-breakpoint
ALTER TABLE "settlement" ADD COLUMN "sourceClientId" text;--> statement-breakpoint
ALTER TABLE "settlement" ADD COLUMN "sourceClientName" text;--> statement-breakpoint
ALTER TABLE "settlement_audit_log" ADD COLUMN "source" text;--> statement-breakpoint
ALTER TABLE "settlement_audit_log" ADD COLUMN "sourceClientId" text;--> statement-breakpoint
ALTER TABLE "settlement_audit_log" ADD COLUMN "sourceClientName" text;