import { integer, real, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

export const races = sqliteTable("races", {
  id: integer("id").primaryKey(),
  name: text("name").notNull().default("Race to 1 Mil"),
  currency: text("currency").notNull().default("USD"),
  startingCapital: real("starting_capital").notNull().default(9000),
  status: text("status").notNull().default("registration"),
  startedAt: integer("started_at", { mode: "timestamp_ms" }),
  endAt: integer("end_at", { mode: "timestamp_ms" }),
  finishedAt: integer("finished_at", { mode: "timestamp_ms" }),
  picksPerPlayer: integer("picks_per_player").notNull().default(9),
  perPickAmount: real("per_pick_amount").notNull().default(1000),
  inviteCode: text("invite_code").notNull().default(""),
  draftOrder: text("draft_order", { mode: "json" }).$type<number[]>().notNull().default([]),
  currentPickIndex: integer("current_pick_index").notNull().default(0),
  scheduledStartAt: integer("scheduled_start_at", { mode: "timestamp_ms" }),
});

export const players = sqliteTable("players", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),
  username: text("username").notNull(),
  passwordHash: text("password_hash").notNull(),
  strategy: text("strategy").notNull().default(""),
  color: text("color").notNull().default("#8884d8"),
}, (table) => [uniqueIndex("players_username_unique").on(table.username)]);

export const assets = sqliteTable("assets", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  symbol: text("symbol").notNull(),
  name: text("name").notNull(),
  type: text("type").notNull(),
  priceSource: text("price_source").notNull(),
  sourceId: text("source_id").notNull(),
  quoteCurrency: text("quote_currency").notNull().default("USD"),
}, (table) => [uniqueIndex("assets_symbol_unique").on(table.symbol)]);

export const positions = sqliteTable("positions", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  playerId: integer("player_id").notNull().references(() => players.id, { onDelete: "cascade" }),
  assetId: integer("asset_id").notNull().references(() => assets.id, { onDelete: "cascade" }),
  allocation: real("allocation").notNull(),
  quantity: real("quantity"),
  startPrice: real("start_price"),
  pickIndex: integer("pick_index"),
  isMvp: integer("is_mvp", { mode: "boolean" }).notNull().default(false),
}, (table) => [uniqueIndex("positions_player_asset_unique").on(table.playerId, table.assetId)]);

export const snapshots = sqliteTable("snapshots", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  playerId: integer("player_id").notNull().references(() => players.id, { onDelete: "cascade" }),
  date: integer("date", { mode: "timestamp_ms" }).notNull(),
  capturedAt: integer("captured_at", { mode: "timestamp_ms" }).notNull(),
  totalValue: real("total_value").notNull(),
  breakdown: text("breakdown", { mode: "json" }).$type<unknown>().notNull(),
  stale: integer("stale", { mode: "boolean" }).notNull().default(false),
}, (table) => [uniqueIndex("snapshots_player_date_unique").on(table.playerId, table.date)]);
