CREATE TABLE `turn_results` (
	`id` text PRIMARY KEY NOT NULL,
	`session_id` text NOT NULL,
	`intent` text NOT NULL,
	`status` text NOT NULL,
	`task` text NOT NULL,
	`summary_json` text,
	`message` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`session_id`) REFERENCES `sessions`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `turn_results_session_id_created_at_idx` ON `turn_results` (`session_id`,`created_at`);