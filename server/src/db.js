import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Default to data/app.db relative to repository root
const DEFAULT_DB_PATH = path.resolve(__dirname, '../../data/app.db');

let defaultDbInstance = null;

/**
 * Creates and initializes a SQLite database connection with proper pragmas.
 * @param {string} [dbPath] - Path to SQLite database file or ':memory:'
 * @returns {import('better-sqlite3').Database}
 */
export function createDatabase(dbPath = process.env.DATABASE_PATH || DEFAULT_DB_PATH) {
  if (dbPath !== ':memory:') {
    const dir = path.dirname(dbPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  }

  const db = new Database(dbPath);

  // Enable WAL mode for concurrency and performance
  db.pragma('journal_mode = WAL');
  // Enforce foreign key constraints
  db.pragma('foreign_keys = ON');
  // Synchronous normal is safe and optimal with WAL
  db.pragma('synchronous = NORMAL');

  return db;
}

/**
 * Returns the singleton database instance.
 * @returns {import('better-sqlite3').Database}
 */
export function getDb() {
  if (!defaultDbInstance) {
    defaultDbInstance = createDatabase();
  }
  return defaultDbInstance;
}

/**
 * Closes the singleton database instance if open (useful in tests).
 */
export function closeDb() {
  if (defaultDbInstance) {
    defaultDbInstance.close();
    defaultDbInstance = null;
  }
}
