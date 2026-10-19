CREATE TABLE `documents` (
	`id` text PRIMARY KEY NOT NULL,
	`body` text NOT NULL,
	`revision` integer NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `events` (
	`id` text PRIMARY KEY NOT NULL,
	`package_id` text,
	`kind` text NOT NULL,
	`raw_text` text NOT NULL,
	`base_revision` integer NOT NULL,
	`created_at` text NOT NULL,
	`result` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `events_package_created` ON `events` (`package_id`,`created_at`);