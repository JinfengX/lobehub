ALTER TABLE "task_topics" ADD COLUMN IF NOT EXISTS "review_passed" integer;--> statement-breakpoint
ALTER TABLE "task_topics" ADD COLUMN IF NOT EXISTS "review_score" integer;--> statement-breakpoint
ALTER TABLE "task_topics" ADD COLUMN IF NOT EXISTS "review_scores" jsonb;--> statement-breakpoint
ALTER TABLE "task_topics" ADD COLUMN IF NOT EXISTS "review_iteration" integer;--> statement-breakpoint
ALTER TABLE "task_topics" ADD COLUMN IF NOT EXISTS "reviewed_at" timestamp with time zone;