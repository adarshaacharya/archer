CREATE TABLE `prompt_history` (
	`id` text PRIMARY KEY NOT NULL,
	`project_root` text NOT NULL,
	`session_id` text,
	`text` text NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `prompt_history_project_root_created_at_idx` ON `prompt_history` (`project_root`,`created_at`);
