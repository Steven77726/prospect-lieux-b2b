import fs from "node:fs";
import { DatabaseSync } from "node:sqlite";

const source = process.argv[2] || "./data/prospect-lieux-b2b.sqlite";
const target = process.argv[3] || "./supabase/seed-from-sqlite.sql";
const db = new DatabaseSync(source, { readOnly: true });

const tables = [
  "users",
  "venues",
  "commercial_data",
  "history",
  "sync_runs",
  "sync_progress",
  "sync_step_status"
];

const lines = [
  "begin;",
  "set session_replication_role = replica;"
];

const booleanColumns = new Set(["is_demo", "already_done", "initial_completed"]);
const nullableTimestampColumns = new Set([
  "created_at",
  "updated_at",
  "started_at",
  "finished_at",
  "last_sync_at",
  "last_checked_at",
  "kactus_verified_at",
  "kactus_validated_at"
]);

for (const table of tables) {
  const rows = db.prepare(`select * from ${table}`).all();
  if (!rows.length) continue;
  const columns = Object.keys(rows[0]);
  for (const row of rows) {
    lines.push(`insert into public.${table} (${columns.map(quoteIdentifier).join(", ")}) values (${columns.map((column) => sqlValue(row[column], column)).join(", ")}) on conflict do nothing;`);
  }
}

lines.push(
  "set session_replication_role = DEFAULT;",
  "commit;",
  ""
);

fs.writeFileSync(target, lines.join("\n"));
console.log(`Export Supabase ecrit dans ${target}`);

function quoteIdentifier(value) {
  return `"${String(value).replace(/"/g, '""')}"`;
}

function sqlValue(value, column) {
  if (value === null || value === undefined) return "null";
  if (booleanColumns.has(column)) return value ? "true" : "false";
  if (nullableTimestampColumns.has(column) && value === "") return "null";
  if (typeof value === "number") return Number.isFinite(value) ? String(value) : "null";
  return `'${String(value).replace(/'/g, "''")}'`;
}
