import request from 'supertest';
import { describe, it, expect, beforeAll } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { app } from '../src/index.js';
import { importService } from '../src/services/importService.js';
import { proposeProfile } from '../src/services/agentProfile.js';
import { getDb } from '../src/db.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURES = path.join(__dirname, 'fixtures');
const readFixture = (name) => fs.readFileSync(path.join(FIXTURES, name));

const CFG_SEMICOLON = {
  encoding: 'utf8',
  delimiter: ';',
  skip_rows: 0,
  has_header_row: true,
  date_format: 'DD/MM/YYYY',
  decimal_separator: ',',
  thousand_separator: '',
  columns: { date: 0, description: 1, amount: 2 },
  cleanup_rules: []
};

const CFG_DEBIT_CREDIT = {
  encoding: 'utf8',
  delimiter: ',',
  skip_rows: 0,
  has_header_row: true,
  date_format: 'YYYY-MM-DD',
  decimal_separator: '.',
  thousand_separator: ',',
  columns: { date: 0, description: 1, debit: 2, credit: 3 },
  cleanup_rules: []
};

async function createAccount(name) {
  const res = await request(app).post('/api/accounts').send({ name, type: 'checking' });
  expect(res.status).toBe(201);
  return res.body;
}

async function createCategory(name, kind = 'expense') {
  const res = await request(app).post('/api/categories').send({ name, kind });
  expect(res.status).toBe(201);
  return res.body;
}

async function createTransaction(overrides) {
  const res = await request(app).post('/api/transactions').send(overrides);
  expect(res.status).toBe(201);
  return res.body;
}

function upload(accountId, buffer, fields) {
  const req = request(app).post('/api/imports').field('accountId', String(accountId));
  for (const [key, value] of Object.entries(fields)) {
    if (value !== undefined) req.field(key, typeof value === 'string' ? value : JSON.stringify(value));
  }
  return req.attach('file', buffer, { filename: 'statement.csv' });
}

describe('Import V2 (AGENT.md section 14)', () => {
  let account;
  let otherAccount;

  beforeAll(async () => {
    account = await createAccount('Banco Importe');
    otherAccount = await createAccount('Outro Banco Importe');
  });

  describe('profiles', () => {
    it('seeds the CGD built-in profile', async () => {
      const res = await request(app).get('/api/import-profiles');
      expect(res.status).toBe(200);
      const cgd = res.body.find((p) => p.name === 'CGD — Movimentos à Ordem');
      expect(cgd).toBeDefined();
      expect(cgd.config.skip_rows).toBe(14);
      expect(cgd.config.columns.amount).toBe(3);
    });

    it('creates, lists and updates profiles; rejects duplicate names and invalid configs', async () => {
      const created = await request(app)
        .post('/api/import-profiles')
        .send({ name: 'Perfil Teste Import', config: CFG_SEMICOLON });
      expect(created.status).toBe(201);
      expect(created.body.config.delimiter).toBe(';');

      const dup = await request(app)
        .post('/api/import-profiles')
        .send({ name: 'Perfil Teste Import', config: CFG_SEMICOLON });
      expect(dup.status).toBe(409);

      const invalid = await request(app)
        .post('/api/import-profiles')
        .send({
          name: 'Perfil Inválido Import',
          config: { ...CFG_SEMICOLON, columns: { date: 0, description: 1 } }
        });
      expect(invalid.status).toBe(400);

      const updated = await request(app)
        .patch(`/api/import-profiles/${created.body.id}`)
        .send({ name: 'Perfil Renomeado Import' });
      expect(updated.status).toBe(200);
      expect(updated.body.name).toBe('Perfil Renomeado Import');
    });
  });

  describe('parsing', () => {
    it('parses semicolon/signed-amount/DD/MM/YYYY with decimal comma', async () => {
      const res = await upload(account.id, readFixture('sample-semicolon-signed.csv'), {
        profileConfig: CFG_SEMICOLON
      });
      expect(res.status).toBe(201);
      expect(res.body.rows).toHaveLength(3);
      expect(res.body.counts.needs_category).toBe(3);

      const [market, salary, servico] = res.body.rows;
      expect(market.date).toBe('2026-03-01');
      expect(market.type).toBe('expense');
      expect(market.amount_cents).toBe(2550);
      expect(salary.type).toBe('income');
      expect(salary.amount_cents).toBe(100000);
      expect(servico.date).toBe('2026-03-02');
      // rows carry hashes for dedupe
      expect(market.import_hash).toMatch(/^[0-9a-f]{64}$/);
    });

    it('parses debit/credit columns and keeps identical same-day rows distinct', async () => {
      const res = await upload(account.id, readFixture('sample-debit-credit.csv'), {
        profileConfig: CFG_DEBIT_CREDIT
      });
      expect(res.status).toBe(201);
      expect(res.body.rows).toHaveLength(4);
      const [market, salary, dup1, dup2] = res.body.rows;
      expect(market.amount_cents).toBe(2550);
      expect(market.type).toBe('expense');
      expect(salary.type).toBe('income');
      // Neither is a duplicate yet (different occurrence_index hashes, DB is empty)
      expect(dup1.match_status).toBe('needs_category');
      expect(dup2.match_status).toBe('needs_category');
      expect(dup1.import_hash).not.toBe(dup2.import_hash);
    });

    it('parses the CGD format via the seeded profile', async () => {
      const profiles = await request(app).get('/api/import-profiles');
      const cgd = profiles.body.find((p) => p.name === 'CGD — Movimentos à Ordem');

      const res = await upload(account.id, readFixture('sample-cgd-like.csv'), {
        profileId: cgd.id
      });
      expect(res.status).toBe(201);
      expect(res.body.rows).toHaveLength(3);
      expect(res.body.profile_id).toBe(cgd.id);
      const [rimas, vodafone, transferencia] = res.body.rows;
      expect(rimas).toMatchObject({ date: '2026-03-01', type: 'expense', amount_cents: 1710 });
      expect(vodafone).toMatchObject({ date: '2026-03-02', type: 'expense', amount_cents: 500 });
      expect(transferencia).toMatchObject({ date: '2026-03-03', type: 'income', amount_cents: 55000 });
    });

    it('parses CGD exports whose header block contains blank lines', async () => {
      // Regression: real 13-11-2026 export with blank separator lines inside
      // the 14-line header block — blank lines must count as physical lines.
      const profiles = await request(app).get('/api/import-profiles');
      const cgd = profiles.body.find((p) => p.name === 'CGD — Movimentos à Ordem');

      const res = await upload(account.id, readFixture('sample-cgd-blank-header-lines.csv'), {
        profileId: cgd.id
      });
      expect(res.status).toBe(201);
      expect(res.body.rows).toHaveLength(2);
      expect(res.body.parse_errors).toHaveLength(0);
      const [vodafone, compra] = res.body.rows;
      expect(vodafone).toMatchObject({ date: '2026-11-13', type: 'expense', amount_cents: 500, description: 'Vodafone' });
      expect(compra).toMatchObject({ date: '2026-11-12', type: 'expense', amount_cents: 2550 });
    });

    it('decodes windows-1252 files', async () => {
      const res = await upload(account.id, readFixture('sample-latin1.csv'), {
        profileConfig: { ...CFG_SEMICOLON, encoding: 'windows-1252' }
      });
      expect(res.status).toBe(201);
      expect(res.body.rows[0].description).toBe('Café Central');
    });

    it('rejects files with no valid rows and reports error lines', async () => {
      const bad = Buffer.from('Data;Descrição;Montante\nxx;yy;zz\n', 'utf8');
      const res = await upload(account.id, bad, { profileConfig: CFG_SEMICOLON });
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('NO_VALID_ROWS');
      expect(res.body.error.details.length).toBeGreaterThan(0);
    });

    it('requires a profile or inline config', async () => {
      const res = await upload(account.id, readFixture('sample-semicolon-signed.csv'), {});
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('PROFILE_REQUIRED');
    });

    it('applies cleanup rules', async () => {
      const csv = Buffer.from('Data;Descrição;Montante\n01/03/2026;COMPRA CAFE LDA;-3,00\n', 'utf8');
      const res = await upload(account.id, csv, {
        profileConfig: {
          ...CFG_SEMICOLON,
          cleanup_rules: [{ type: 'strip_prefix', value: 'COMPRA ' }, { type: 'strip_suffix', value: ' LDA' }]
        }
      });
      expect(res.status).toBe(201);
      expect(res.body.rows[0].description).toBe('CAFE');
    });
  });

  describe('category matching (deterministic)', () => {
    it('matches exact normalized names, reuses spelling and most-used category', async () => {
      const mercado = await createCategory('Mercado Match Import');
      const servicos = await createCategory('Servicos Match Import');
      // Two uses of the same name/category, one with different spelling elsewhere
      await createTransaction({
        date: '2026-02-01', type: 'expense', amount_cents: 1000, name: 'SUPERMERCADO X',
        category_id: mercado.id, account_id: account.id
      });
      await createTransaction({
        date: '2026-02-05', type: 'expense', amount_cents: 1100, name: 'Supermercado X',
        category_id: mercado.id, account_id: account.id
      });
      await createTransaction({
        date: '2026-02-07', type: 'expense', amount_cents: 1200, name: 'Pagamento Servico',
        category_id: servicos.id, account_id: account.id
      });

      const res = await upload(account.id, readFixture('sample-semicolon-signed.csv'), {
        profileConfig: CFG_SEMICOLON
      });
      const [market, salary, servico] = res.body.rows;
      expect(market.match_status).toBe('matched');
      expect(market.category_id).toBe(mercado.id);
      // Most frequently used spelling wins
      expect(market.name).toBe('SUPERMERCADO X');
      expect(servico.match_status).toBe('matched');
      expect(servico.name).toBe('Pagamento Servico');
      expect(servico.category_id).toBe(servicos.id);
      expect(salary.match_status).toBe('needs_category');
      expect(salary.category_id).toBeNull();
    });

    it('marks ambiguous when the name appears under several categories', async () => {
      const outro = await createCategory('Outro Match Import');
      await createTransaction({
        date: '2026-02-10', type: 'expense', amount_cents: 500, name: 'Supermercado X',
        category_id: outro.id, account_id: account.id
      });

      const res = await upload(account.id, readFixture('sample-semicolon-signed.csv'), {
        profileConfig: CFG_SEMICOLON
      });
      const market = res.body.rows[0];
      expect(market.match_status).toBe('ambiguous');
      // Most-used category still proposed (2 uses vs 1)
      expect(market.category_name).toBe('Mercado Match Import');
    });
  });

  describe('dedupe and commit', () => {
    it('blocks commit while rows are unresolved, then commits atomically', async () => {
      const acc = await createAccount('Banco Commit Block');
      const res = await upload(acc.id, readFixture('sample-semicolon-signed.csv'), {
        profileConfig: CFG_SEMICOLON
      });
      const batchId = res.body.id;

      const early = await request(app).post(`/api/imports/${batchId}/commit`);
      expect(early.status).toBe(400);
      expect(early.body.error.code).toBe('UNRESOLVED_ROWS');

      // Nothing was written before commit
      const db = getDb();
      const before = db.prepare('SELECT COUNT(*) c FROM transactions WHERE account_id = ?').get(acc.id).c;
      expect(before).toBe(0);

      const category = await createCategory('Commit Block Import');
      const incomeCategory = await createCategory('Commit Receita Import', 'income');
      for (const row of res.body.rows) {
        const cat = row.type === 'expense' ? category : incomeCategory;
        const patch = await request(app)
          .patch(`/api/imports/${batchId}/rows/${row.id}`)
          .send({ category_id: cat.id });
        expect(patch.status).toBe(200);
      }

      const commit = await request(app).post(`/api/imports/${batchId}/commit`);
      expect(commit.status).toBe(200);
      expect(commit.body.created).toBe(3);

      const txs = db
        .prepare('SELECT name, type, amount_cents, import_hash FROM transactions WHERE account_id = ? ORDER BY date')
        .all(acc.id);
      expect(txs).toHaveLength(3);
      expect(txs.every((t) => t.import_hash)).toBe(true);

      const doubleCommit = await request(app).post(`/api/imports/${batchId}/commit`);
      expect(doubleCommit.status).toBe(409);
    });

    it('flags repeated imports of the same file as duplicates', async () => {
      const acc = await createAccount('Banco Dedupe');
      const csv = readFixture('sample-debit-credit.csv');
      const config = { profileConfig: CFG_DEBIT_CREDIT };

      const first = await upload(acc.id, csv, config);
      expect(first.status).toBe(201);
      const expenseCat = await createCategory('Dedupe Despesa Import');
      const incomeCat = await createCategory('Dedupe Receita Import', 'income');
      for (const row of first.body.rows) {
        const category = row.type === 'expense' ? expenseCat : incomeCat;
        const patch = await request(app)
          .patch(`/api/imports/${first.body.id}/rows/${row.id}`)
          .send({ category_id: category.id });
        expect(patch.status).toBe(200);
      }
      const commit = await request(app).post(`/api/imports/${first.body.id}/commit`);
      expect(commit.status).toBe(200);
      expect(commit.body.created).toBe(4);

      // Second import of the same file: everything is a duplicate
      const second = await upload(acc.id, csv, config);
      expect(second.body.counts.duplicate).toBe(4);
      expect(second.body.counts.matched + second.body.counts.needs_category + second.body.counts.ambiguous).toBe(0);
    });

    it('excluded rows are skipped at commit', async () => {
      const acc = await createAccount('Banco Exclude');
      const csv = Buffer.from(
        'Data;Descrição;Montante\n01/04/2026;A EXCLUIR;-5,00\n02/04/2026;B MANTER;-6,00\n', 'utf8'
      );
      const res = await upload(acc.id, csv, { profileConfig: CFG_SEMICOLON });
      const [rowA, rowB] = res.body.rows;
      const category = await createCategory('Exclude Block Import');

      const excl = await request(app).patch(`/api/imports/${res.body.id}/rows/${rowA.id}`).send({ excluded: true });
      expect(excl.status).toBe(200);
      const keep = await request(app)
        .patch(`/api/imports/${res.body.id}/rows/${rowB.id}`)
        .send({ category_id: category.id });
      expect(keep.status).toBe(200);

      const commit = await request(app).post(`/api/imports/${res.body.id}/commit`);
      expect(commit.status).toBe(200);
      expect(commit.body.created).toBe(1);

      const db = getDb();
      const names = db
        .prepare(`SELECT name FROM transactions WHERE account_id = ? AND (name LIKE '%MANTER%' OR name LIKE '%EXCLUIR%')`)
        .all(acc.id);
      expect(names.map((n) => n.name)).toEqual(['B MANTER']);
    });

    it('converts rows to transfers between own accounts', async () => {
      const acc = await createAccount('Banco Transfer');
      const csv = Buffer.from('Data;Descrição;Montante\n05/04/2026;TRF PARA OUTRO BANCO;-50,00\n', 'utf8');
      const res = await upload(acc.id, csv, { profileConfig: CFG_SEMICOLON });
      const row = res.body.rows[0];

      // Transfers must not be blocked by the missing category
      const patch = await request(app)
        .patch(`/api/imports/${res.body.id}/rows/${row.id}`)
        .send({ type: 'transfer', to_account_id: otherAccount.id });
      expect(patch.status).toBe(200);

      const commit = await request(app).post(`/api/imports/${res.body.id}/commit`);
      expect(commit.status).toBe(200);

      const db = getDb();
      const tx = db
        .prepare('SELECT type, to_account_id, category_id FROM transactions WHERE account_id = ? AND name = ?')
        .get(acc.id, 'TRF PARA OUTRO BANCO');
      expect(tx.type).toBe('transfer');
      expect(tx.to_account_id).toBe(otherAccount.id);
      expect(tx.category_id).toBeNull();
    });

    it('discards drafts and closes them for edits', async () => {
      const acc = await createAccount('Banco Discard');
      const res = await upload(acc.id, readFixture('sample-semicolon-signed.csv'), {
        profileConfig: CFG_SEMICOLON
      });
      const del = await request(app).delete(`/api/imports/${res.body.id}`);
      expect(del.status).toBe(200);
      expect(del.body.status).toBe('discarded');

      const patch = await request(app)
        .patch(`/api/imports/${res.body.id}/rows/${res.body.rows[0].id}`)
        .send({ excluded: true });
      expect(patch.status).toBe(409);
    });
  });

  describe('planned transaction reconciliation', () => {
    it('proposes, requires confirmation, and confirms instead of duplicating', async () => {
      const acc = await createAccount('Banco Planned');
      const mercado = await createCategory('Planned Match Import');
      // Unique description so global name knowledge points only to this category
      const csv = Buffer.from('Data;Descrição;Montante\n01/03/2026;PLANNED UNIQUE DESC;-25,50\n', 'utf8');
      await createTransaction({
        date: '2026-01-10', type: 'expense', amount_cents: 2000, name: 'PLANNED UNIQUE DESC',
        category_id: mercado.id, account_id: acc.id
      });
      // A planned movement close (4 days) to the imported row, same amount/category
      const planned = await createTransaction({
        date: '2026-03-05', type: 'expense', amount_cents: 2550, name: 'Compra supermercado',
        category_id: mercado.id, account_id: acc.id, status: 'planned'
      });

      const res = await upload(acc.id, csv, {
        profileConfig: CFG_SEMICOLON
      });
      expect(res.body.rows).toHaveLength(1);
      const market = res.body.rows[0];
      expect(market.planned_transaction_id).toBe(planned.id);

      const db = getDb();
      const txBefore = db.prepare('SELECT COUNT(*) c FROM transactions WHERE account_id = ?').get(acc.id).c;

      const accept = await request(app)
        .patch(`/api/imports/${res.body.id}/rows/${market.id}`)
        .send({ accept_planned: true });
      expect(accept.status).toBe(200);

      const commit = await request(app).post(`/api/imports/${res.body.id}/commit`);
      expect(commit.status).toBe(200);
      expect(commit.body.reconciled).toBe(1);
      expect(commit.body.created).toBe(0); // single row reconciled

      const txAfter = db.prepare('SELECT COUNT(*) c FROM transactions WHERE account_id = ?').get(acc.id).c;
      expect(txAfter).toBe(txBefore); // reconciled, not duplicated

      // The planned transaction was confirmed with the imported date/amount
      const confirmed = db
        .prepare('SELECT date, amount_cents, status, import_hash FROM transactions WHERE id = ?')
        .get(planned.id);
      expect(confirmed.status).toBe('confirmed');
      expect(confirmed.date).toBe('2026-03-01');
      expect(confirmed.amount_cents).toBe(2550);
      expect(confirmed.import_hash).toBe(market.import_hash);
    });
  });

  describe('agent profile fallback (opt-in, mocked)', () => {
    it('fails clearly without ANTHROPIC_API_KEY', async () => {
      const hadKey = process.env.ANTHROPIC_API_KEY;
      delete process.env.ANTHROPIC_API_KEY;
      try {
        await expect(
          proposeProfile({ header: 'A;B;C', sample: '1;2;3' })
        ).rejects.toMatchObject({ code: 'AGENT_UNAVAILABLE' });
      } finally {
        if (hadKey) process.env.ANTHROPIC_API_KEY = hadKey;
      }
    });

    it('accepts a valid proposal from a mocked API response', async () => {
      const fetchFn = async () => ({
        ok: true,
        json: async () => ({
          model: 'claude-test',
          content: [
            {
              type: 'tool_use',
              name: 'propose_import_profile',
              input: {
                ...CFG_DEBIT_CREDIT,
                columns: { date: 0, description: 1, amount: null, debit: 2, credit: 3 },
                skip_rows: 1,
                has_header_row: false
              }
            }
          ]
        })
      });
      const proposal = await proposeProfile({ header: 'h', sample: 's' }, { apiKey: 'test-key', fetchFn });
      expect(proposal.config.delimiter).toBe(',');
      expect(proposal.model).toBe('claude-test');
    });

    it('rejects malformed proposals (schema validation)', async () => {
      const fetchFn = async () => ({
        ok: true,
        json: async () => ({
          model: 'claude-test',
          content: [
            {
              type: 'tool_use',
              name: 'propose_import_profile',
              input: { encoding: 'utf8', delimiter: ';;' /* invalid */ }
            }
          ]
        })
      });
      await expect(
        proposeProfile({ header: 'h', sample: 's' }, { apiKey: 'test-key', fetchFn })
      ).rejects.toMatchObject({ code: 'AGENT_MALFORMED' });
    });
  });
});
