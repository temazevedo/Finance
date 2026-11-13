import request from 'supertest';
import { describe, it, expect, beforeEach } from 'vitest';
import { getDb } from '../src/db.js';
import { app } from '../src/index.js';

describe('Name Suggestions API (/api/suggestions/names)', () => {
  const db = getDb();
  let account;
  let category;

  beforeEach(() => {
    db.prepare('DELETE FROM skipped_occurrences').run();
    db.prepare('DELETE FROM transactions').run();
    db.prepare('DELETE FROM recurring_items').run();
    db.prepare('DELETE FROM accounts').run();

    // Create test account
    const accResult = db
      .prepare("INSERT INTO accounts (name, type) VALUES ('Conta Teste', 'checking')")
      .run();
    account = { id: accResult.lastInsertRowid };

    // Fetch a leaf category (Supermercado under Alimentação)
    category = db.prepare("SELECT id FROM categories WHERE name = 'Supermercado'").get();
  });

  it('fails with 400 validation error if categoryId is missing', async () => {
    const res = await request(app).get('/api/suggestions/names');
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('orders suggestions by usage count DESC', async () => {
    // Insert 1x "Celeiro", 3x "Continente", 2x "Pingo Doce"
    const insertTx = db.prepare(`
      INSERT INTO transactions (date, type, amount_cents, account_id, category_id, name)
      VALUES (?, 'expense', ?, ?, ?, ?)
    `);

    insertTx.run('2026-05-01', 1000, account.id, category.id, 'Celeiro');

    insertTx.run('2026-05-01', 2500, account.id, category.id, 'Continente');
    insertTx.run('2026-05-02', 3000, account.id, category.id, 'Continente');
    insertTx.run('2026-05-03', 3500, account.id, category.id, 'Continente');

    insertTx.run('2026-05-01', 1500, account.id, category.id, 'Pingo Doce');
    insertTx.run('2026-05-02', 1800, account.id, category.id, 'Pingo Doce');

    const res = await request(app)
      .get('/api/suggestions/names')
      .query({ categoryId: category.id });

    expect(res.status).toBe(200);
    expect(res.body.length).toBe(3);

    // 1st: Continente (3 uses)
    expect(res.body[0].name).toBe('Continente');
    expect(res.body[0].uses).toBe(3);
    expect(res.body[0].last_amount_cents).toBe(3500); // Most recent amount

    // 2nd: Pingo Doce (2 uses)
    expect(res.body[1].name).toBe('Pingo Doce');
    expect(res.body[1].uses).toBe(2);
    expect(res.body[1].last_amount_cents).toBe(1800);

    // 3rd: Celeiro (1 use)
    expect(res.body[2].name).toBe('Celeiro');
    expect(res.body[2].uses).toBe(1);
    expect(res.body[2].last_amount_cents).toBe(1000);
  });

  it('breaks ties using last_used date DESC', async () => {
    const insertTx = db.prepare(`
      INSERT INTO transactions (date, type, amount_cents, account_id, category_id, name)
      VALUES (?, 'expense', ?, ?, ?, ?)
    `);

    // Both have 1 use, but Auchan was used on May 10th and Lidl on May 2nd
    insertTx.run('2026-05-02', 2000, account.id, category.id, 'Lidl');
    insertTx.run('2026-05-10', 4000, account.id, category.id, 'Auchan');

    const res = await request(app)
      .get('/api/suggestions/names')
      .query({ categoryId: category.id });

    expect(res.status).toBe(200);
    expect(res.body[0].name).toBe('Auchan');
    expect(res.body[1].name).toBe('Lidl');
  });

  it('groups names case-insensitively', async () => {
    const insertTx = db.prepare(`
      INSERT INTO transactions (date, type, amount_cents, account_id, category_id, name)
      VALUES (?, 'expense', ?, ?, ?, ?)
    `);

    insertTx.run('2026-05-01', 2000, account.id, category.id, 'Mercadona');
    insertTx.run('2026-05-03', 2500, account.id, category.id, 'mercadona');

    const res = await request(app)
      .get('/api/suggestions/names')
      .query({ categoryId: category.id });

    expect(res.status).toBe(200);
    expect(res.body.length).toBe(1);
    expect(res.body[0].uses).toBe(2);
    expect(res.body[0].last_amount_cents).toBe(2500);
  });

  it('filters by search prefix', async () => {
    const insertTx = db.prepare(`
      INSERT INTO transactions (date, type, amount_cents, account_id, category_id, name)
      VALUES (?, 'expense', ?, ?, ?, ?)
    `);

    insertTx.run('2026-05-01', 1000, account.id, category.id, 'Continente Bom Dia');
    insertTx.run('2026-05-02', 2000, account.id, category.id, 'Continente Modelo');
    insertTx.run('2026-05-03', 3000, account.id, category.id, 'Pingo Doce');

    const res = await request(app)
      .get('/api/suggestions/names')
      .query({ categoryId: category.id, q: 'con' });

    expect(res.status).toBe(200);
    expect(res.body.length).toBe(2);
    expect(res.body.every((s) => s.name.toLowerCase().startsWith('con'))).toBe(true);
  });

  it('cold starts suggestions from active recurring items with 0 uses', async () => {
    // Add active recurring item in this category with 0 transaction history
    db.prepare(`
      INSERT INTO recurring_items (name, type, category_id, account_id, amount_cents, frequency, start_date, active)
      VALUES ('Cabaz Semanal Bio', 'expense', ?, ?, 4500, 'weekly', '2026-05-01', 1)
    `).run(category.id, account.id);

    // Also add one normal transaction
    db.prepare(`
      INSERT INTO transactions (date, type, amount_cents, account_id, category_id, name)
      VALUES ('2026-05-02', 'expense', 1500, ?, ?, 'Minipreço')
    `).run(account.id, category.id);

    const res = await request(app)
      .get('/api/suggestions/names')
      .query({ categoryId: category.id });

    expect(res.status).toBe(200);
    expect(res.body.length).toBe(2);

    // 1st should be Minipreço (1 use)
    expect(res.body[0].name).toBe('Minipreço');
    expect(res.body[0].uses).toBe(1);

    // 2nd should be recurring item Cabaz Semanal Bio (0 uses, last_amount_cents from recurring item)
    expect(res.body[1].name).toBe('Cabaz Semanal Bio');
    expect(res.body[1].uses).toBe(0);
    expect(res.body[1].last_amount_cents).toBe(4500);
  });
});
