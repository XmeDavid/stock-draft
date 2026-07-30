CREATE TABLE `assets` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`symbol` text NOT NULL,
	`name` text NOT NULL,
	`type` text NOT NULL,
	`price_source` text NOT NULL,
	`source_id` text NOT NULL,
	`quote_currency` text DEFAULT 'USD' NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `assets_symbol_unique` ON `assets` (`symbol`);--> statement-breakpoint
CREATE TABLE `players` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`username` text NOT NULL,
	`password_hash` text NOT NULL,
	`strategy` text DEFAULT '' NOT NULL,
	`color` text DEFAULT '#8884d8' NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `players_username_unique` ON `players` (`username`);--> statement-breakpoint
CREATE TABLE `positions` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`player_id` integer NOT NULL,
	`asset_id` integer NOT NULL,
	`allocation` real NOT NULL,
	`quantity` real,
	`start_price` real,
	`pick_index` integer,
	`is_mvp` integer DEFAULT false NOT NULL,
	FOREIGN KEY (`player_id`) REFERENCES `players`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`asset_id`) REFERENCES `assets`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `positions_player_asset_unique` ON `positions` (`player_id`,`asset_id`);--> statement-breakpoint
CREATE TABLE `races` (
	`id` integer PRIMARY KEY NOT NULL,
	`name` text DEFAULT 'Race to 1 Mil' NOT NULL,
	`currency` text DEFAULT 'USD' NOT NULL,
	`starting_capital` real DEFAULT 10000 NOT NULL,
	`status` text DEFAULT 'registration' NOT NULL,
	`started_at` integer,
	`end_at` integer,
	`finished_at` integer,
	`picks_per_player` integer DEFAULT 10 NOT NULL,
	`per_pick_amount` real DEFAULT 1000 NOT NULL,
	`invite_code` text DEFAULT '' NOT NULL,
	`draft_order` text DEFAULT '[]' NOT NULL,
	`current_pick_index` integer DEFAULT 0 NOT NULL,
	`scheduled_start_at` integer
);
--> statement-breakpoint
CREATE TABLE `snapshots` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`player_id` integer NOT NULL,
	`date` integer NOT NULL,
	`captured_at` integer NOT NULL,
	`total_value` real NOT NULL,
	`breakdown` text NOT NULL,
	`stale` integer DEFAULT false NOT NULL,
	FOREIGN KEY (`player_id`) REFERENCES `players`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `snapshots_player_date_unique` ON `snapshots` (`player_id`,`date`);