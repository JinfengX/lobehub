ALTER TABLE "briefs" ADD COLUMN IF NOT EXISTS "resolved_action" text;--> statement-breakpoint
ALTER TABLE "briefs" ADD COLUMN IF NOT EXISTS "resolved_comment" text;
