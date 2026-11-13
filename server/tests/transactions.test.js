import request from 'supertest';
import { describe, it, expect, beforeEach } from 'vitest';
import { getDb } from '../src/db.js';
import { app } from '../src/index.js';

describe('Transactions API (/api/transactions)', () => {
  const db = getDb();
  let checkingAcc;
  let savingsAcc;
  let leafCat;
  let parentCat;
  let standaloneLeafCat;

  beforeEach(async () => {
    db.prepare('DELETE FROM skipped_occurrences').run();
    db.prepare('DELETE FROM transactions').run();
    db.prepare('DELETE FROM recurring_items').run();
    db.prepare('DELETE FROM accounts').run();

    // Setup accounts
    checkingAcc = (
      await request(app)
        .post('/api/accounts')
        .send({ name: 'Conta Ordem', type: 'checking', initial_balance_cents: 200000 })
    ).body;

    savingsAcc = (
      await request(app)
        .post('/api/accounts')
        .send({ name: 'Conta Poupança', type: 'savings', initial_balance_cents: 50000 })
    ).body;

    // Get parent category with children
    parentCat = db.prepare('SELECT * FROM categories WHERE parent_id IS NULL AND id = 1').get(); // Habitação
    // Get leaf child category
    leafCat = db.prepare('SELECT * FROM categories WHERE parent_id = 1 LIMIT 1').get();

    // Create standalone leaf category (root category with no children)
    const catRes = await request(app).post('/api/categories').send({
      name: 'Donativos Teste',
      kind: 'expense',
      budget_group: 'wants'
    });
    standaloneLeafCat = catRes.body;
  });

  it('rejects transactions linked to non-leaf categories', async () => {
    const res = await request(app).post('/api/transactions').send({
      date: '2026-05-01',
      type: 'expense',
      amount_cents: 1000,
      account_id: checkingAcc.id,
      category_id: parentCat.id, // Parent with children
      name: 'Teste Não Folha'
    });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('NON_LEAF_CATEGORY');
  });

  it('allows transactions on subcategory leaves and standalone root leaves', async () => {
    // Subcategory leaf
    const resChild = await request(app).post('/api/transactions').send({
      date: '2026-05-01',
      type: 'expense',
      amount_cents: 4500,
      account_id: checkingAcc.id,
      category_id: leafCat.id,
      name: 'Renda'
    });
    expect(resChild.status).toBe(201);
    expect(resChild.body.category_id).toBe(leafCat.id);

    // Standalone root leaf
    const resStandalone = await request(app).post('/api/transactions').send({
      date: '2026-05-02',
      type: 'expense',
      amount_cents: 1000,
      account_id: checkingAcc.id,
      category_id: standaloneLeafCat.id,
      name: 'Donativo Cruz Vermelha'
    });
    expect(resStandalone.status).toBe(201);
    expect(resStandalone.body.category_id).toBe(standaloneLeafCat.id);
  });

  it('handles transfer transactions with validation', async () => {
    // 1. Same account transfer rejected
    const resSame = await request(app).post('/api/transactions').send({
      date: '2026-05-01',
      type: 'transfer',
      amount_cents: 2000,
      account_id: checkingAcc.id,
      to_account_id: checkingAcc.id
    });
    expect(resSame.status).toBe(400);

    // 2. Transfer with category rejected
    const resWithCat = await request(app).post('/api/transactions').send({
      date: '2026-05-01',
      type: 'transfer',
      amount_cents: 2000,
      account_id: checkingAcc.id,
      to_account_id: savingsAcc.id,
      category_id: leafCat.id
    });
    expect(resWithCat.status).toBe(400);

    // 3. Valid transfer
    const resValid = await request(app).post('/api/transactions').send({
      date: '2026-05-01',
      type: 'transfer',
      amount_cents: 25000, // 250,00 €
      account_id: checkingAcc.id,
      to_account_id: savingsAcc.id,
      name: 'Poupança Mensal',
      notes: 'Transferência para fundo'
    });
    expect(resValid.status).toBe(201);
    expect(resValid.body.type).toBe('transfer');
    expect(resValid.body.category_id).toBeNull();
    expect(resValid.body.to_account_name).toBe('Conta Poupança');
  });

  it('normalizes names and reuses most common casing in the category', async () => {
    // First transaction with "Pingo Doce"
    await request(app).post('/api/transactions').send({
      date: '2026-05-01',
      type: 'expense',
      amount_cents: 3000,
      account_id: checkingAcc.id,
      category_id: leafCat.id,
      name: '  Pingo Doce  '
    });

    // Second transaction with different casing: "pingo doce"
    const res2 = await request(app).post('/api/transactions').send({
      date: '2026-05-02',
      type: 'expense',
      amount_cents: 2500,
      account_id: checkingAcc.id,
      category_id: leafCat.id,
      name: 'pingo doce'
    });

    expect(res2.status).toBe(201);
    // Should reuse the existing "Pingo Doce" casing
    expect(res2.body.name).toBe('Pingo Doce');
  });

  it('filters transactions by date, account, type, and search query', async () => {
    await request(app).post('/api/transactions').send({
      date: '2026-04-15',
      type: 'expense',
      amount_cents: 1500,
      account_id: checkingAcc.id,
      category_id: leafCat.id,
      name: 'Restaurante A'
    });
    await request(app).post('/api/transactions').send({
      date: '2026-05-15',
      type: 'expense',
      amount_cents: 2500,
      account_id: checkingAcc.id,
      category_id: leafCat.id,
      name: 'Restaurante B'
    });

    // Date range filter
    const resRange = await request(app)
      .get('/api/transactions')
      .query({ from: '2026-05-01', to: '2026-05-31' });
    expect(resRange.body.data.length).toBe(1);
    expect(resRange.body.data[0].name).toBe('Restaurante B');

    // Search filter
    const resSearch = await request(app).get('/api/transactions').query({ q: 'Restaurante A' });
    expect(resSearch.body.data.length).toBe(1);
    expect(resSearch.body.data[0].name).toBe('Restaurante A');
  });

  it('records skipped_occurrences when deleting a planned transaction with recurring_id', async () => {
    // Insert a recurring item first to satisfy foreign key constraint
    const recStmt = db.prepare(`
      INSERT INTO recurring_items (name, type, category_id, account_id, amount_cents, frequency, start_date)
      VALUES ('Internet MEO', 'expense', ?, ?, 5000, 'monthly', '2026-01-01')
    `);
    const recInfo = recStmt.run(leafCat.id, checkingAcc.id);
    const recurringId = recInfo.lastInsertRowid;

    // Insert a planned transaction with recurring_id directly
    const insertStmt = db.prepare(`
      INSERT INTO transactions (date, type, amount_cents, account_id, category_id, status, recurring_id)
      VALUES ('2026-06-01', 'expense', 5000, ?, ?, 'planned', ?)
    `);
    const info = insertStmt.run(checkingAcc.id, leafCat.id, recurringId);
    const txId = info.lastInsertRowid;

    const resDel = await request(app).delete(`/api/transactions/${txId}`);
    expect(resDel.status).toBe(204);

    const skipped = db
      .prepare('SELECT * FROM skipped_occurrences WHERE recurring_id = ? AND date = ?')
      .get(recurringId, '2026-06-01');
    expect(skipped).toBeDefined();
  });
});
