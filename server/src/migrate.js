import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getDb } from './db.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const MIGRATIONS_DIR = path.resolve(__dirname, 'migrations');

/**
 * Runs all pending migrations against the given or default database instance.
 * @param {import('better-sqlite3').Database} [database]
 * @returns {{ applied: string[], total: number }}
 */
export function runMigrations(database) {
  const db = database || getDb();

  // Ensure migrations tracking table exists
  db.exec(`
    CREATE TABLE IF NOT EXISTS _migrations (
      id INTEGER PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      applied_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);

  const appliedRows = db.prepare('SELECT name FROM _migrations ORDER BY id ASC').all();
  const appliedNames = new Set(appliedRows.map((r) => r.name));

  const files = fs
    .readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.sql'))
    .sort();

  const newlyApplied = [];

  for (const file of files) {
    if (!appliedNames.has(file)) {
      const filePath = path.join(MIGRATIONS_DIR, file);
      const sql = fs.readFileSync(filePath, 'utf8');

      // Execute migration inside a single atomic transaction
      const applyMigration = db.transaction(() => {
        db.exec(sql);
        db.prepare('INSERT INTO _migrations (name) VALUES (?)').run(file);
      });

      applyMigration();
      newlyApplied.push(file);
    }
  }

  return { applied: newlyApplied, total: files.length };
}

// Support direct CLI execution: node src/migrate.js
if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(__filename)) {
  try {
    const result = runMigrations();
    if (result.applied.length > 0) {
      console.log(`Successfully applied ${result.applied.length} migration(s):`, result.applied);
    } else {
      console.log('Database is up to date. No pending migrations.');
    }
  } catch (error) {
    console.error('Migration failed:', error);
    process.exit(1);
  }
}
