ALTER TABLE "task_topics" ADD COLUMN "user_id" text NOT NULL;--> statement-breakpoint
ALTER TABLE "task_topics" ADD COLUMN "handoff_title" text;--> statement-breakpoint
ALTER TABLE "task_topics" ADD COLUMN "handoff_summary" text;--> statement-breakpoint
ALTER TABLE "task_topics" ADD COLUMN "handoff_key_findings" jsonb;--> statement-breakpoint
ALTER TABLE "task_topics" ADD COLUMN "handoff_next_action" text;--> statement-breakpoint
ALTER TABLE "task_topics" ADD CONSTRAINT "task_topics_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "task_topics_user_id_idx" ON "task_topics" USING btree ("user_id");