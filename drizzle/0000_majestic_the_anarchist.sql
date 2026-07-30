CREATE TABLE "assets" (
	"id" serial PRIMARY KEY NOT NULL,
	"symbol" text NOT NULL,
	"name" text NOT NULL,
	"type" text NOT NULL,
	"price_source" text NOT NULL,
	"source_id" text NOT NULL,
	"quote_currency" text DEFAULT 'USD' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "players" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"username" text NOT NULL,
	"password_hash" text NOT NULL,
	"strategy" text DEFAULT '' NOT NULL,
	"color" text DEFAULT '#8884d8' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "positions" (
	"id" serial PRIMARY KEY NOT NULL,
	"player_id" integer NOT NULL,
	"asset_id" integer NOT NULL,
	"allocation" double precision NOT NULL,
	"quantity" double precision,
	"start_price" double precision,
	"pick_index" integer,
	"is_mvp" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE "races" (
	"id" integer PRIMARY KEY NOT NULL,
	"name" text DEFAULT 'Race to 1 Mil' NOT NULL,
	"currency" text DEFAULT 'USD' NOT NULL,
	"starting_capital" double precision DEFAULT 9000 NOT NULL,
	"status" text DEFAULT 'registration' NOT NULL,
	"started_at" timestamp with time zone,
	"end_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"picks_per_player" integer DEFAULT 9 NOT NULL,
	"per_pick_amount" double precision DEFAULT 1000 NOT NULL,
	"invite_code" text DEFAULT '' NOT NULL,
	"draft_order" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"current_pick_index" integer DEFAULT 0 NOT NULL,
	"scheduled_start_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "snapshots" (
	"id" serial PRIMARY KEY NOT NULL,
	"player_id" integer NOT NULL,
	"date" date NOT NULL,
	"captured_at" timestamp with time zone NOT NULL,
	"total_value" double precision NOT NULL,
	"breakdown" jsonb NOT NULL,
	"stale" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
ALTER TABLE "positions" ADD CONSTRAINT "positions_player_id_players_id_fk" FOREIGN KEY ("player_id") REFERENCES "public"."players"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "positions" ADD CONSTRAINT "positions_asset_id_assets_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."assets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "snapshots" ADD CONSTRAINT "snapshots_player_id_players_id_fk" FOREIGN KEY ("player_id") REFERENCES "public"."players"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "assets_symbol_unique" ON "assets" USING btree ("symbol");--> statement-breakpoint
CREATE UNIQUE INDEX "players_username_unique" ON "players" USING btree ("username");--> statement-breakpoint
CREATE UNIQUE INDEX "positions_player_asset_unique" ON "positions" USING btree ("player_id","asset_id");--> statement-breakpoint
CREATE UNIQUE INDEX "snapshots_player_date_unique" ON "snapshots" USING btree ("player_id","date");