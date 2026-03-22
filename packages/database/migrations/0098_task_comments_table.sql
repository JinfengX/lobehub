CREATE TABLE IF NOT EXISTS "task_comments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"task_id" text NOT NULL,
	"user_id" text,
	"agent_id" text,
	"content" text NOT NULL,
	"editor_data" jsonb,
	"brief_id" uuid,
	"topic_id" text,
	"accessed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "task_comments" DROP CONSTRAINT IF EXISTS "task_comments_task_id_tasks_id_fk";
ALTER TABLE "task_comments" ADD CONSTRAINT "task_comments_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "task_comments_task_id_idx" ON "task_comments" USING btree ("task_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "task_comments_user_id_idx" ON "task_comments" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "task_comments_agent_id_idx" ON "task_comments" USING btree ("agent_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "task_comments_brief_id_idx" ON "task_comments" USING btree ("brief_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "task_comments_topic_id_idx" ON "task_comments" USING btree ("topic_id");