PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_races` (
	`id` integer PRIMARY KEY NOT NULL,
	`name` text DEFAULT 'Race to 1 Mil' NOT NULL,
	`currency` text DEFAULT 'USD' NOT NULL,
	`starting_capital` real DEFAULT 9000 NOT NULL,
	`status` text DEFAULT 'registration' NOT NULL,
	`started_at` integer,
	`end_at` integer,
	`finished_at` integer,
	`picks_per_player` integer DEFAULT 9 NOT NULL,
	`per_pick_amount` real DEFAULT 1000 NOT NULL,
	`invite_code` text DEFAULT '' NOT NULL,
	`draft_order` text DEFAULT '[]' NOT NULL,
	`current_pick_index` integer DEFAULT 0 NOT NULL,
	`scheduled_start_at` integer
);
--> statement-breakpoint
INSERT INTO `__new_races`("id", "name", "currency", "starting_capital", "status", "started_at", "end_at", "finished_at", "picks_per_player", "per_pick_amount", "invite_code", "draft_order", "current_pick_index", "scheduled_start_at") SELECT "id", "name", "currency", "starting_capital", "status", "started_at", "end_at", "finished_at", "picks_per_player", "per_pick_amount", "invite_code", "draft_order", "current_pick_index", "scheduled_start_at" FROM `races`;--> statement-breakpoint
DROP TABLE `races`;--> statement-breakpoint
ALTER TABLE `__new_races` RENAME TO `races`;--> statement-breakpoint
PRAGMA foreign_keys=ON;