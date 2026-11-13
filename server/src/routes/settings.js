import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Router } from 'express';
import { getDb } from '../db.js';
import { updateSettingsSchema } from '../schemas/settings.js';
import { DEFAULT_BACKUP_DIR, createBackup } from '../services/backupService.js';
import { generateTransactionsCsv } from '../services/exportService.js';
import { validateBody } from '../utils/validation.js';

export const settingsRouter = Router();

const USER_ADJUSTABLE_KEYS = ['budget_method'];

function readSetting(key) {
  return getDb().prepare('SELECT value FROM settings WHERE key = ?').get(key)?.value ?? null;
}

// GET /api/settings - user-adjustable preferences
settingsRouter.get('/', (req, res, next) => {
  try {
    res.json({
      budget_method: readSetting('budget_method'),
      backup_dir: DEFAULT_BACKUP_DIR
    });
  } catch (err) {
    next(err);
  }
});

// PUT /api/settings - update user-adjustable preferences
settingsRouter.put('/', validateBody(updateSettingsSchema), (req, res, next) => {
  try {
    const db = getDb();
    const runUpdate = db.transaction(() => {
      for (const [key, value] of Object.entries(req.body)) {
        if (!USER_ADJUSTABLE_KEYS.includes(key)) continue;
        db
          .prepare(
            'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'
          )
          .run(key, String(value));
      }
    });
    runUpdate();

    res.json({ budget_method: readSetting('budget_method') });
  } catch (err) {
    next(err);
  }
});

// GET /api/settings/backup - download the SQLite database backup file
settingsRouter.get('/backup', async (req, res, next) => {
  let tmpPath = null;
  try {
    tmpPath = path.join(os.tmpdir(), `app-download-${Date.now()}.db`);
    await getDb().backup(tmpPath);

    const stamp = new Date().toISOString().replace(/[:T]/g, '-').split('.')[0];
    const downloadName = `orcamento-backup-${stamp}.db`;
    res.download(tmpPath, downloadName, (err) => {
      if (!res.headersSent && err) next(err);
      fs.rm(tmpPath, { force: true }, () => {});
    });
  } catch (err) {
    if (tmpPath) fs.rm(tmpPath, { force: true }, () => {});
    next(err);
  }
});

// GET /api/settings/export/csv - download all transactions as CSV
settingsRouter.get('/export/csv', (req, res, next) => {
  try {
    const csv = generateTransactionsCsv();
    const stamp = new Date().toISOString().split('T')[0];
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="transacoes-${stamp}.csv"`);
    res.send(csv);
  } catch (err) {
    next(err);
  }
});
