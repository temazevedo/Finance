import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/**
 * Vitest setup: isolate every test file in its own throwaway SQLite database.
 *
 * The server's db.js resolves its default to <repo>/data/app.db, which is the
 * USER'S LIVE DATA. Tests must never touch it: this setup runs before test
 * files are imported and points DATABASE_PATH at a fresh temporary file
 * (migrations are applied by index.js at import time).
 */
const testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'budget-tests-'));
process.env.DATABASE_PATH = path.join(testDir, 'app.db');
