CREATE TABLE `channels` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `tokens` (
	`id` text PRIMARY KEY NOT NULL,
	`channel_id` text NOT NULL,
	`token_hash` text NOT NULL,
	`label` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`channel_id`) REFERENCES `channels`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `reports` (
	`id` text PRIMARY KEY NOT NULL,
	`channel_id` text NOT NULL,
	`type` text NOT NULL,
	`body` text NOT NULL,
	`agent_id` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`channel_id`) REFERENCES `channels`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `messages` (
	`id` text PRIMARY KEY NOT NULL,
	`channel_id` text NOT NULL,
	`direction` text NOT NULL,
	`body` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`channel_id`) REFERENCES `channels`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `agents` (
	`id` text PRIMARY KEY NOT NULL,
	`channel_id` text NOT NULL,
	`agent_id` text NOT NULL,
	`name` text,
	`platform` text NOT NULL,
	`schedule` text,
	`last_run_at` integer,
	`status` text DEFAULT 'unknown' NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`channel_id`) REFERENCES `channels`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `agent_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`channel_id` text NOT NULL,
	`agent_id` text NOT NULL,
	`started_at` integer NOT NULL,
	`finished_at` integer NOT NULL,
	`status` text NOT NULL,
	`duration_ms` integer NOT NULL,
	`log_excerpt` text,
	`error_summary` text,
	`token_usage` text,
	`cost_cents` integer,
	FOREIGN KEY (`channel_id`) REFERENCES `channels`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `rate_limits` (
	`token_id` text NOT NULL,
	`window_start` integer NOT NULL,
	`count` integer DEFAULT 1 NOT NULL,
	PRIMARY KEY(`token_id`, `window_start`)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `agents_channel_agent_uniq` ON `agents` (`channel_id`,`agent_id`);
--> statement-breakpoint
CREATE UNIQUE INDEX `agent_runs_channel_agent_started_uniq` ON `agent_runs` (`channel_id`,`agent_id`,`started_at`);
