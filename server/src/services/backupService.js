import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getDb } from '../db.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// data/backups at the repository root (this file lives in server/src/services)
export const DEFAULT_BACKUP_DIR = path.resolve(__dirname, '../../../data/backups');

export const BACKUP_FILENAME_PATTERN = /^app-\d{8}-\d{6}\.db$/;
export const DEFAULT_RETENTION = 14;

/**
 * Creates a backup data file using SQLite's online backup API.
 * Safe to run while the server is processing requests (WAL mode).
 * @param {string} [destDir] - Directory where the backup is stored
 * @param {import('better-sqlite3').Database} [db]
 * @returns {Promise<{ dir: string, filename: string, path: string }>}
 */
export async function createBackup(destDir = DEFAULT_BACKUP_DIR, db = getDb()) {
  fs.mkdirSync(destDir, { recursive: true });

  const filename = `app-${formatTimestamp()}.db`;
  const fullPath = path.join(destDir, filename);

  await db.backup(fullPath);
  pruneBackups(destDir, DEFAULT_RETENTION);

  return { dir: destDir, filename, path: fullPath };
}

/**
 * Removes oldest timestamped backups keeping only the most recent `keep` ones.
 * @param {string} destDir
 * @param {number} [keep=14]
 * @returns {string[]} removed filenames
 */
export function pruneBackups(destDir, keep = DEFAULT_RETENTION) {
  if (!fs.existsSync(destDir)) return [];

  const backups = fs
    .readdirSync(destDir)
    .filter((name) => BACKUP_FILENAME_PATTERN.test(name))
    .sort((a, b) => b.localeCompare(a)); // newest first

  const toRemove = backups.slice(keep);
  for (const name of toRemove) {
    fs.unlinkSync(path.join(destDir, name));
  }
  return toRemove;
}

function formatTimestamp() {
  const now = new Date();
  const p = (n, w = 2) => String(n).padStart(w, '0');
  return (
    `${now.getFullYear()}${p(now.getMonth() + 1)}${p(now.getDate())}` +
    `-${p(now.getHours())}${p(now.getMinutes())}${p(now.getSeconds())}`
  );
}
