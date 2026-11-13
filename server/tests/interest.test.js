import request from 'supertest';
import { describe, it, expect } from 'vitest';
import { app } from '../src/index.js';
import { interestService } from '../src/services/interestService.js';
import { getDb } from '../src/db.js';

async function createInvestmentAccount(overrides = {}) {
  const res = await request(app)
    .post('/api/accounts')
    .send({
      name: 'Conta Invest Teste Juros',
      type: 'investment',
      initial_balance_cents: 10000,
      ...overrides
    });
  expect(res.status).toBe(201);
  return res.body;
}

describe('Interest on investment accounts', () => {
  it('rejects interest fields on non-investment accounts', async () => {
    const res = await request(app)
      .post('/api/accounts')
      .send({
        name: 'Conta À Ordem Com Juros',
        type: 'checking',
        initial_balance_cents: 0,
        interest_rate: 2.5,
        interest_period: 'annual'
      });
    expect(res.status).toBe(400);
    // Schema-level refine surfaces as VALIDATION_ERROR; the service check
    // (INTEREST_NOT_ALLOWED) covers PATCH where the type comes from the DB.
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('creates and updates an investment account with interest fields', async () => {
    const created = await createInvestmentAccount({
      name: 'Investimento Com Juros',
      interest_rate: 2.85,
      interest_period: 'annual'
    });
    expect(created.interest_rate).toBe(2.85);
    expect(created.interest_period).toBe('annual');

    const updated = await request(app)
      .patch(`/api/accounts/${created.id}`)
      .send({ interest_rate: 3, interest_period: 'monthly' });
    expect(updated.status).toBe(200);
    expect(updated.body.interest_rate).toBe(3);
    expect(updated.body.interest_period).toBe('monthly');

    // Changing type away from investment clears interest config
    const changed = await request(app)
      .patch(`/api/accounts/${created.id}`)
      .send({ type: 'savings' });
    expect(changed.status).toBe(200);
    expect(changed.body.interest_rate).toBeNull();
    expect(changed.body.interest_period).toBeNull();
  });

  it('validates interest rate range', async () => {
    const res = await request(app)
      .post('/api/accounts')
      .send({
        name: 'Investimento Taxa Invalida',
        type: 'investment',
        interest_rate: 150
      });
    expect(res.status).toBe(400);
  });

  it('posts monthly interest for the last elapsed period (idempotent)', async () => {
    // 12% annual on 100.00 € => 1% monthly => 1.00 € for the first month
    const account = await createInvestmentAccount({
      name: 'Investimento Mensal Juros',
      interest_rate: 12,
      interest_period: 'monthly'
    });

    const result = interestService.generateInterestPostings('2026-02-01');
    expect(result.postedCount).toBe(1);

    const db = getDb();
    const tx = db
      .prepare(`SELECT date, type, amount_cents, name, status FROM transactions WHERE account_id = ? AND type = 'income'`)
      .get(account.id);
    expect(tx.date).toBe('2026-01-31');
    expect(tx.amount_cents).toBe(100);
    expect(tx.name).toBe('Juros — Investimento Mensal Juros');
    expect(tx.status).toBe('confirmed');

    // Posting recorded in the ledger
    const posting = db
      .prepare('SELECT amount_cents FROM interest_postings WHERE account_id = ? AND period = ?')
      .get(account.id, '2026-01');
    expect(posting.amount_cents).toBe(100);

    // Re-run for the same period: no duplicates
    const again = interestService.generateInterestPostings('2026-02-01');
    expect(again.postedCount).toBe(0);
    const count = db
      .prepare(`SELECT COUNT(*) c FROM transactions WHERE account_id = ? AND type = 'income'`)
      .get(account.id).c;
    expect(count).toBe(1);

    // Next run (March) posts February interest on the new balance (100.00 + 1.00 = 101.00 => 1.01 €)
    const next = interestService.generateInterestPostings('2026-03-01');
    expect(next.postedCount).toBe(1);
    const feb = db
      .prepare(`SELECT amount_cents FROM transactions WHERE account_id = ? AND type = 'income' AND date = '2026-02-28'`)
      .get(account.id);
    expect(feb.amount_cents).toBe(101);
  });

  it('computes interest on the balance including confirmed movements', async () => {
    const account = await createInvestmentAccount({
      name: 'Investimento Com Movimentos Juros',
      interest_rate: 12,
      interest_period: 'monthly'
    });

    // Expense of 20.00 € mid-January => balance at end of January = 80.00 €
    const cat = await request(app)
      .post('/api/categories')
      .send({ name: 'Categoria Despesa Teste Juros', kind: 'expense' });
    expect(cat.status).toBe(201);
    const txRes = await request(app).post('/api/transactions').send({
      date: '2026-01-15',
      type: 'expense',
      amount_cents: 2000,
      name: 'Levantamento',
      category_id: cat.body.id,
      account_id: account.id
    });
    expect(txRes.status).toBe(201);

    interestService.generateInterestPostings('2026-02-01');

    const db = getDb();
    const tx = db
      .prepare(`SELECT amount_cents FROM transactions WHERE account_id = ? AND type = 'income'`)
      .get(account.id);
    expect(tx.amount_cents).toBe(80); // 1% of 80.00 €
  });

  it('posts annual interest dated Dec 31 of the previous year', async () => {
    const account = await createInvestmentAccount({
      name: 'Investimento Anual Juros',
      interest_rate: 10,
      interest_period: 'annual'
    });

    const result = interestService.generateInterestPostings('2026-01-05');
    // Other eligible accounts from earlier tests may also post here; the
    // important part is that THIS account's annual interest was posted.
    expect(result.postedCount).toBeGreaterThanOrEqual(1);

    const db = getDb();
    const tx = db
      .prepare(`SELECT date, amount_cents FROM transactions WHERE account_id = ? AND type = 'income'`)
      .get(account.id);
    expect(tx.date).toBe('2025-12-31');
    expect(tx.amount_cents).toBe(1000); // 10% of 100.00 €
  });

  it('does not post interest when the period end is today or later', async () => {
    await createInvestmentAccount({
      name: 'Investimento Sem Periodo Elapsed Juros',
      interest_rate: 12,
      interest_period: 'monthly'
    });

    // referenceDate is inside January: period = 2025-12, ended 2025-12-31 < 2026-01-15
    // => the account posts December interest, not January
    interestService.generateInterestPostings('2026-01-15');

    const db = getDb();
    const tx = db
      .prepare(`SELECT date FROM transactions WHERE type = 'income' AND name LIKE 'Juros — Investimento Sem Periodo Elapsed Juros%'`)
      .get();
    expect(tx.date).toBe('2025-12-31');
  });

  it('ignores accounts without interest configuration', async () => {
    await createInvestmentAccount({ name: 'Investimento Sem Taxa Juros' });
    const result = interestService.generateInterestPostings('2026-02-01');
    const db = getDb();
    const count = db
      .prepare(`SELECT COUNT(*) c FROM transactions WHERE name LIKE 'Juros — Investimento Sem Taxa Juros%'`)
      .get().c;
    expect(count).toBe(0);
  });
});
