import { getDb } from './db.js';
import { runMigrations } from './migrate.js';
import { DEFAULT_BACKUP_DIR, createBackup } from './services/backupService.js';

/**
 * CLI backup entrypoint (npm run backup / npm run backup -w server).
 * Uses SQLite's online backup API into data/backups/ with timestamps and
 * retention (keeps the most recent 14 files).
 */
async function main() {
  const db = getDb();
  runMigrations(db);

  const { filename } = await createBackup();
  console.log(`Backup criado: ${filename} (em ${DEFAULT_BACKUP_DIR})`);
}

main().catch((err) => {
  console.error('Falha ao criar backup:', err.message);
  process.exit(1);
});
