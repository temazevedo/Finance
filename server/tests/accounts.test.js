import request from 'supertest';
import { describe, it, expect, beforeEach } from 'vitest';
import { getDb } from '../src/db.js';
import { app } from '../src/index.js';

describe('Accounts API (/api/accounts)', () => {
  const db = getDb();

  beforeEach(() => {
    // Clear test data in order of foreign key dependency
    db.prepare('DELETE FROM skipped_occurrences').run();
    db.prepare('DELETE FROM transactions').run();
    db.prepare('DELETE FROM recurring_items').run();
    db.prepare('DELETE FROM accounts').run();
  });

  it('creates and lists accounts', async () => {
    const resCreate = await request(app)
      .post('/api/accounts')
      .send({
        name: 'Conta Corrente CGD',
        type: 'checking',
        initial_balance_cents: 150000 // 1 500,00 €
      });

    expect(resCreate.status).toBe(201);
    expect(resCreate.body.id).toBeDefined();
    expect(resCreate.body.name).toBe('Conta Corrente CGD');
    expect(resCreate.body.initial_balance_cents).toBe(150000);

    const resList = await request(app).get('/api/accounts');
    expect(resList.status).toBe(200);
    expect(resList.body.length).toBe(1);
    expect(resList.body[0].name).toBe('Conta Corrente CGD');
  });

  it('rejects invalid account data', async () => {
    const res = await request(app).post('/api/accounts').send({
      name: '',
      type: 'invalid_type'
    });

    expect(res.status).toBe(400);
    expect(res.body.error).toBeDefined();
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('rejects duplicate active account names but allows reusing archived names', async () => {
    await request(app)
      .post('/api/accounts')
      .send({ name: 'Carteira', type: 'cash', initial_balance_cents: 2000 });

    const resDup = await request(app)
      .post('/api/accounts')
      .send({ name: 'Carteira', type: 'cash', initial_balance_cents: 1000 });

    expect(resDup.status).toBe(409);
    expect(resDup.body.error.code).toBe('ACCOUNT_EXISTS');

    // Archive the account
    const accounts = (await request(app).get('/api/accounts')).body;
    await request(app).patch(`/api/accounts/${accounts[0].id}`).send({ archived: 1 });

    // Now creating with same name should succeed
    const resRecreate = await request(app)
      .post('/api/accounts')
      .send({ name: 'Carteira', type: 'cash', initial_balance_cents: 5000 });

    expect(resRecreate.status).toBe(201);
  });

  it('calculates accurate account balances ignoring planned transactions', async () => {
    // 1. Create checking account with 100€
    const accChecking = (
      await request(app)
        .post('/api/accounts')
        .send({ name: 'Ordem', type: 'checking', initial_balance_cents: 10000 })
    ).body;

    // 2. Create savings account with 500€
    const accSavings = (
      await request(app)
        .post('/api/accounts')
        .send({ name: 'Poupança', type: 'savings', initial_balance_cents: 50000 })
    ).body;

    // Fetch leaf category
    const leafCategory = db
      .prepare("SELECT id FROM categories WHERE parent_id IS NOT NULL AND kind = 'expense' LIMIT 1")
      .get();
    const incomeCategory = db
      .prepare("SELECT id FROM categories WHERE parent_id IS NOT NULL AND kind = 'income' LIMIT 1")
      .get();

    // 3. Add confirmed expense 30€
    await request(app).post('/api/transactions').send({
      date: '2026-05-01',
      type: 'expense',
      amount_cents: 3000,
      account_id: accChecking.id,
      category_id: leafCategory.id,
      name: 'Supermercado',
      status: 'confirmed'
    });

    // 4. Add planned expense 20€ (MUST NOT affect balance)
    await request(app).post('/api/transactions').send({
      date: '2026-05-10',
      type: 'expense',
      amount_cents: 2000,
      account_id: accChecking.id,
      category_id: leafCategory.id,
      name: 'Eletricidade Planeada',
      status: 'planned'
    });

    // 5. Add confirmed income 50€
    await request(app).post('/api/transactions').send({
      date: '2026-05-02',
      type: 'income',
      amount_cents: 5000,
      account_id: accChecking.id,
      category_id: incomeCategory.id,
      name: 'Venda OLX',
      status: 'confirmed'
    });

    // 6. Confirmed transfer 40€ from Checking -> Savings
    await request(app).post('/api/transactions').send({
      date: '2026-05-03',
      type: 'transfer',
      amount_cents: 4000,
      account_id: accChecking.id,
      to_account_id: accSavings.id,
      status: 'confirmed'
    });

    const resBalances = await request(app).get('/api/accounts/balances');
    expect(resBalances.status).toBe(200);

    const checkingBal = resBalances.body.find((a) => a.id === accChecking.id);
    const savingsBal = resBalances.body.find((a) => a.id === accSavings.id);

    // Checking: 100€ (initial) - 30€ (expense) + 50€ (income) - 40€ (transfer out) = 80€ (8000 cents)
    expect(checkingBal.balance_cents).toBe(8000);

    // Savings: 500€ (initial) + 40€ (transfer in) = 540€ (54000 cents)
    expect(savingsBal.balance_cents).toBe(54000);
  });
});
