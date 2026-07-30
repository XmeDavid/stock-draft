import {
  boolean,
  date,
  doublePrecision,
  integer,
  jsonb,
  pgTable,
  serial,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";

export const races = pgTable("races", {
  id: integer("id").primaryKey(),
  name: text("name").notNull().default("Race to 1 Mil"),
  currency: text("currency").notNull().default("USD"),
  startingCapital: doublePrecision("starting_capital").notNull().default(10000),
  status: text("status").notNull().default("registration"),
  startedAt: timestamp("started_at", { withTimezone: true, mode: "date" }),
  endAt: timestamp("end_at", { withTimezone: true, mode: "date" }),
  finishedAt: timestamp("finished_at", { withTimezone: true, mode: "date" }),
  picksPerPlayer: integer("picks_per_player").notNull().default(10),
  perPickAmount: doublePrecision("per_pick_amount").notNull().default(1000),
  inviteCode: text("invite_code").notNull().default(""),
  draftOrder: jsonb("draft_order").$type<number[]>().notNull().default([]),
  currentPickIndex: integer("current_pick_index").notNull().default(0),
  scheduledStartAt: timestamp("scheduled_start_at", { withTimezone: true, mode: "date" }),
});

export const players = pgTable("players", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  username: text("username").notNull(),
  passwordHash: text("password_hash").notNull(),
  strategy: text("strategy").notNull().default(""),
  color: text("color").notNull().default("#8884d8"),
}, (table) => [uniqueIndex("players_username_unique").on(table.username)]);

export const assets = pgTable("assets", {
  id: serial("id").primaryKey(),
  symbol: text("symbol").notNull(),
  name: text("name").notNull(),
  type: text("type").notNull(),
  priceSource: text("price_source").notNull(),
  sourceId: text("source_id").notNull(),
  quoteCurrency: text("quote_currency").notNull().default("USD"),
}, (table) => [uniqueIndex("assets_symbol_unique").on(table.symbol)]);

export const positions = pgTable("positions", {
  id: serial("id").primaryKey(),
  playerId: integer("player_id").notNull().references(() => players.id, { onDelete: "cascade" }),
  assetId: integer("asset_id").notNull().references(() => assets.id, { onDelete: "cascade" }),
  allocation: doublePrecision("allocation").notNull(),
  quantity: doublePrecision("quantity"),
  startPrice: doublePrecision("start_price"),
  pickIndex: integer("pick_index"),
  isMvp: boolean("is_mvp").notNull().default(false),
}, (table) => [uniqueIndex("positions_player_asset_unique").on(table.playerId, table.assetId)]);

export const snapshots = pgTable("snapshots", {
  id: serial("id").primaryKey(),
  playerId: integer("player_id").notNull().references(() => players.id, { onDelete: "cascade" }),
  date: date("date", { mode: "date" }).notNull(),
  capturedAt: timestamp("captured_at", { withTimezone: true, mode: "date" }).notNull(),
  totalValue: doublePrecision("total_value").notNull(),
  breakdown: jsonb("breakdown").$type<unknown>().notNull(),
  stale: boolean("stale").notNull().default(false),
}, (table) => [uniqueIndex("snapshots_player_date_unique").on(table.playerId, table.date)]);
