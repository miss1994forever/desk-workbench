import { index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const documents = sqliteTable("documents", {
  id: text("id").primaryKey(),
  body: text("body").notNull(),
  revision: integer("revision").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export const events = sqliteTable("events", {
  id: text("id").primaryKey(),
  packageId: text("package_id"),
  kind: text("kind").notNull(),
  rawText: text("raw_text").notNull(),
  baseRevision: integer("base_revision").notNull(),
  createdAt: text("created_at").notNull(),
  result: text("result").notNull(),
}, (table) => [index("events_package_created").on(table.packageId, table.createdAt)]);
