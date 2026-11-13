import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import request from 'supertest';
import { describe, it, expect, beforeEach } from 'vitest';
import { getDb } from '../src/db.js';
import { app } from '../src/index.js';
import { createBackup, pruneBackups, BACKUP_FILENAME_PATTERN } from '../src/services/backupService.js';

describe('Backups & Settings (Milestone 6)', () => {
  const db = getDb();

  beforeEach(() => {
    db.prepare('DELETE FROM skipped_occurrences').run();
    db.prepare('DELETE FROM transactions').run();
    db.prepare('DELETE FROM recurring_items').run();
    db.prepare('DELETE FROM budgets').run();
    db.prepare('DELETE FROM accounts').run();
    db.prepare("DELETE FROM settings WHERE key = 'budget_method'").run();
  });

  describe('Backup service', () => {
    it('creates a readable SQLite backup file', async () => {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'backups-test-'));

      const { path: backupPath } = await createBackup(dir);
      expect(fs.existsSync(backupPath)).toBe(true);
      expect(BACKUP_FILENAME_PATTERN.test(path.basename(backupPath))).toBe(true);

      // The backup file must be an openable SQLite database with the app schema
      const backupDb = new Database(backupPath, { readonly: true });
      const tables = backupDb
        .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
        .all()
        .map((r) => r.name);
      backupDb.close();

      expect(tables).toContain('accounts');
      expect(tables).toContain('transactions');
    });

    it('prunes old backups keeping only the newest N', async () => {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'backups-test-'));

      // 18 fake stale backups + 1 real one = 19 -> prune keeps 14
      for (let i = 1; i <= 18; i++) {
        const name = `app-20200101-0000${String(i).padStart(2, '0')}.db`;
        fs.writeFileSync(path.join(dir, name), 'stale');
      }
      await createBackup(dir);

      const remaining = fs.readdirSync(dir).filter((n) => BACKUP_FILENAME_PATTERN.test(n));
      expect(remaining).toHaveLength(14);
      // The 4 oldest stale backups are gone; the fresh one survives
      expect(remaining).not.toContain('app-20200101-000001.db');
      expect(remaining).not.toContain('app-20200101-000002.db');
      expect(remaining).not.toContain('app-20200101-000003.db');
      expect(remaining).not.toContain('app-20200101-000004.db');
      expect(remaining.some((n) => !n.startsWith('app-2020'))).toBe(true);
    });
  });

  describe('Settings API', () => {
    it('persists and returns the budget method preference', async () => {
      expect((await request(app).get('/api/settings')).body.budget_method).toBeNull();

      const put = await request(app).put('/api/settings').send({ budget_method: 'zero_based' });
      expect(put.status).toBe(200);
      expect(put.body.budget_method).toBe('zero_based');

      expect((await request(app).get('/api/settings')).body.budget_method).toBe('zero_based');

      const invalid = await request(app).put('/api/settings').send({ budget_method: 'wizard_method' });
      expect(invalid.status).toBe(400);
      expect(invalid.body.error.code).toBe('VALIDATION_ERROR');
    });

    it('exports all transactions as CSV including transfers', async () => {
      const account = (
        await request(app).post('/api/accounts').send({
          name: 'Export Conta',
          type: 'checking',
          initial_balance_cents: 100000
        })
      ).body;

      await request(app).post('/api/transactions').send({
        date: '2026-02-03',
        type: 'expense',
        amount_cents: 1250,
        category_id: db.prepare('SELECT id FROM categories WHERE parent_id IS NOT NULL LIMIT 1').get().id,
        account_id: account.id,
        name: 'Pão; leite', // exercises CSV escaping of the separator
        status: 'confirmed'
      });
      await request(app).post('/api/transactions').send({
        date: '2026-02-04',
        type: 'income',
        amount_cents: 20000,
        category_id: db
          .prepare(
            "SELECT id FROM categories WHERE kind = 'income' AND id NOT IN (SELECT parent_id FROM categories WHERE parent_id IS NOT NULL) LIMIT 1"
          )
          .get().id,
        account_id: account.id,
        status: 'confirmed'
      });

      const res = await request(app).get('/api/settings/export/csv');
      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toContain('text/csv');

      const body = res.text;
      expect(body.startsWith('\uFEFF')).toBe(true);
      expect(body).toContain('id;data;tipo;designacao;categoria;conta;conta_destino;montante_eur;montante_cents;estado;notas');
      expect(body).toContain('"Pão; leite"'); // separator inside value forces quoting, quotes are doubled
      expect(body).toContain('Pão; leite');
      expect(body.split('\r\n')).toHaveLength(4); // header + 2 rows + trailing empty line
    });

    it('downloads a SQLite backup file from the API', async () => {
      const res = await request(app)
        .get('/api/settings/backup')
        .buffer(true)
        .parse((res, cb) => {
          const chunks = [];
          res.on('data', (c) => chunks.push(c));
          res.on('end', () => cb(null, Buffer.concat(chunks)));
        });

      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toContain('application/octet-stream');
      expect(res.headers['content-disposition']).toContain('attachment');
      expect(res.headers['content-disposition']).toContain('.db');

      // SQLite magic header
      expect(res.body.subarray(0, 15).toString('utf8')).toBe('SQLite format 3');
    });
  });
});
