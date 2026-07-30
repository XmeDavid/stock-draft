ALTER TABLE "races" ALTER COLUMN "starting_capital" SET DEFAULT 10000;--> statement-breakpoint
ALTER TABLE "races" ALTER COLUMN "picks_per_player" SET DEFAULT 10;--> statement-breakpoint
UPDATE "races"
SET
	"picks_per_player" = 10,
	"starting_capital" = "per_pick_amount" * 10
WHERE
	"status" = 'registration'
	AND "picks_per_player" = 9
	AND "starting_capital" = "per_pick_amount" * 9;
