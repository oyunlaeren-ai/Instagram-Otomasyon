import { MIGRATIONS } from "./migrations";
import type { Database } from "sql.js";

export function runMigrations(db: Database): void {
  db.run(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      appliedAt TEXT NOT NULL
    )
  `);

  const applied = new Set(
    db
      .exec("SELECT name FROM schema_migrations")
      .flatMap((result) => result.values.map((row) => String(row[0])))
  );

  for (const migration of MIGRATIONS) {
    if (applied.has(migration.name)) {
      continue;
    }
    db.run("BEGIN");
    try {
      for (const statement of migration.sql
        .split(";")
        .map((part) => part.trim())
        .filter((part) => part.length > 0)) {
        db.run(statement);
      }
      db.run("INSERT INTO schema_migrations (name, appliedAt) VALUES (?, ?)", [
        migration.name,
        new Date().toISOString()
      ]);
      db.run("COMMIT");
    } catch (error) {
      db.run("ROLLBACK");
      throw error;
    }
  }
}
