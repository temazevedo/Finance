import request from 'supertest';
import { describe, it, expect, beforeEach } from 'vitest';
import { getDb } from '../src/db.js';
import { app } from '../src/index.js';

describe('Budgets & Reports (Milestone 5)', () => {
  const db = getDb();
  let checkingAcc;
  let savingsAcc;
  let leafExpenseCatA;
  let leafExpenseCatB;
  let parentExpenseCat;
  let incomeLeafCat;

  beforeEach(async () => {
    db.prepare('DELETE FROM skipped_occurrences').run();
    db.prepare('DELETE FROM transactions').run();
    db.prepare('DELETE FROM recurring_items').run();
    db.prepare('DELETE FROM budgets').run();
    db.prepare('DELETE FROM accounts').run();

    checkingAcc = (
      await request(app)
        .post('/api/accounts')
        .send({ name: 'Conta Ordem M5', type: 'checking', initial_balance_cents: 200000 })
    ).body;
    savingsAcc = (
      await request(app)
        .post('/api/accounts')
        .send({ name: 'Poupança M5', type: 'savings', initial_balance_cents: 50000 })
    ).body;

    // Build own expense category tree to be independent of other suites
    parentExpenseCat = (
      await request(app).post('/api/categories').send({ name: 'Transportes M5', kind: 'expense' })
    ).body;
    leafExpenseCatA = (
      await request(app)
        .post('/api/categories')
        .send({ name: 'Combustível M5', kind: 'expense', parent_id: parentExpenseCat.id })
    ).body;
    leafExpenseCatB = (
      await request(app)
        .post('/api/categories')
        .send({ name: 'Transportes públicos M5', kind: 'expense', parent_id: parentExpenseCat.id })
    ).body;
    incomeLeafCat = (
      await request(app).post('/api/categories').send({ name: 'Salário M5', kind: 'income', parent_id: null })
    ).body;
  });

  describe('Budget CRUD', () => {
    it('bulk upserts budgets and lists them for a month', async () => {
      const put = await request(app)
        .put('/api/budgets?month=2026-02')
        .send({
          budgets: [
            { category_id: leafExpenseCatA.id, amount_cents: 10000 },
            { category_id: leafExpenseCatB.id, amount_cents: 20000 }
          ]
        });
      expect(put.status).toBe(200);

      const get = await request(app).get('/api/budgets?month=2026-02');
      expect(get.status).toBe(200);
      expect(get.body.budgets).toHaveLength(2);

      const byCat = new Map(get.body.budgets.map((b) => [b.category_id, b]));
      expect(byCat.get(leafExpenseCatA.id).amount_cents).toBe(10000);
      expect(byCat.get(leafExpenseCatB.id).amount_cents).toBe(20000);
      expect(byCat.get(leafExpenseCatA.id).category_name).toBe('Combustível M5');
      expect(byCat.get(leafExpenseCatA.id).parent_category_name).toBe('Transportes M5');
    });

    it('overwrites existing amounts on re-upsert', async () => {
      await request(app)
        .put('/api/budgets?month=2026-02')
        .send({ budgets: [{ category_id: leafExpenseCatA.id, amount_cents: 10000 }] });
      await request(app)
        .put('/api/budgets?month=2026-02')
        .send({ budgets: [{ category_id: leafExpenseCatA.id, amount_cents: 12000 }] });

      const get = await request(app).get('/api/budgets?month=2026-02');
      expect(get.body.budgets).toHaveLength(1);
      expect(get.body.budgets[0].amount_cents).toBe(12000);
    });

    it('rejects invalid month formats and validation errors', async () => {
      const badMonth = await request(app)
        .put('/api/budgets?month=2026-2')
        .send({ budgets: [{ category_id: leafExpenseCatA.id, amount_cents: 100 }] });
      expect(badMonth.status).toBe(400);
      expect(badMonth.body.error.code).toBe('VALIDATION_ERROR');

      const noQuery = await request(app).get('/api/budgets');
      expect(noQuery.status).toBe(400);

      const negative = await request(app)
        .put('/api/budgets?month=2026-02')
        .send({ budgets: [{ category_id: leafExpenseCatA.id, amount_cents: -100 }] });
      expect(negative.status).toBe(400);
      expect(negative.body.error.code).toBe('VALIDATION_ERROR');
    });

    it('rejects non-leaf, archived and income categories', async () => {
      const nonLeaf = await request(app)
        .put('/api/budgets?month=2026-02')
        .send({ budgets: [{ category_id: parentExpenseCat.id, amount_cents: 100 }] });
      expect(nonLeaf.status).toBe(400);
      expect(nonLeaf.body.error.code).toBe('NON_LEAF_CATEGORY');

      const incomeCat = await request(app)
        .put('/api/budgets?month=2026-02')
        .send({ budgets: [{ category_id: incomeLeafCat.id, amount_cents: 100 }] });
      expect(incomeCat.status).toBe(400);
      expect(incomeCat.body.error.code).toBe('INVALID_CATEGORY_KIND');
    });
  });

  describe('Budget vs actual with rollover carryover', () => {
    it('carries unspent surplus forward to the next month', async () => {
      // January: budget 100€, spent 80€ -> +20€ carryover into February
      await request(app)
        .put('/api/budgets?month=2026-01')
        .send({ budgets: [{ category_id: leafExpenseCatA.id, amount_cents: 10000 }] });
      await request(app).post('/api/transactions').send({
        date: '2026-01-05',
        type: 'expense',
        amount_cents: 8000,
        category_id: leafExpenseCatA.id,
        account_id: checkingAcc.id,
        status: 'confirmed'
      });

      // February: budget 50€
      await request(app)
        .put('/api/budgets?month=2026-02')
        .send({ budgets: [{ category_id: leafExpenseCatA.id, amount_cents: 5000 }] });

      const report = await request(app).get('/api/reports/budget-vs-actual?month=2026-02');
      expect(report.status).toBe(200);

      const row = report.body.categories.find((c) => c.category_id === leafExpenseCatA.id);
      expect(row.budgeted_cents).toBe(5000);
      expect(row.carryover_cents).toBe(2000);
      expect(row.available_cents).toBe(7000);
      expect(row.actual_cents).toBe(0);
      expect(row.remaining_cents).toBe(7000);
      expect(row.is_overspent).toBe(false);
    });

    it('carries overspent deficits forward as negative adjustment', async () => {
      // January: budget 100€, spent 120€ -> -20€ carryover into February
      await request(app)
        .put('/api/budgets?month=2026-01')
        .send({ budgets: [{ category_id: leafExpenseCatA.id, amount_cents: 10000 }] });
      await request(app).post('/api/transactions').send({
        date: '2026-01-05',
        type: 'expense',
        amount_cents: 12000,
        category_id: leafExpenseCatA.id,
        account_id: checkingAcc.id,
        status: 'confirmed'
      });

      // February: budget 50€
      await request(app)
        .put('/api/budgets?month=2026-02')
        .send({ budgets: [{ category_id: leafExpenseCatA.id, amount_cents: 5000 }] });

      const report = await request(app).get('/api/reports/budget-vs-actual?month=2026-02');
      const row = report.body.categories.find((c) => c.category_id === leafExpenseCatA.id);
      expect(row.carryover_cents).toBe(-2000);
      expect(row.available_cents).toBe(3000);
      expect(row.is_overspent).toBe(false);

      // Overspending in the report month itself is flagged
      await request(app).post('/api/transactions').send({
        date: '2026-02-10',
        type: 'expense',
        amount_cents: 4000,
        category_id: leafExpenseCatA.id,
        account_id: checkingAcc.id,
        status: 'confirmed'
      });
      const report2 = await request(app).get('/api/reports/budget-vs-actual?month=2026-02');
      const row2 = report2.body.categories.find((c) => c.category_id === leafExpenseCatA.id);
      expect(row2.actual_cents).toBe(4000);
      expect(row2.remaining_cents).toBe(-1000);
      expect(row2.is_overspent).toBe(true);
    });

    it('aggregates parent totals by summing leaf children', async () => {
      await request(app)
        .put('/api/budgets?month=2026-03')
        .send({
          budgets: [
            { category_id: leafExpenseCatA.id, amount_cents: 10000 },
            { category_id: leafExpenseCatB.id, amount_cents: 25000 }
          ]
        });
      await request(app).post('/api/transactions').send({
        date: '2026-03-05',
        type: 'expense',
        amount_cents: 3000,
        category_id: leafExpenseCatA.id,
        account_id: checkingAcc.id,
        status: 'confirmed'
      });

      const report = await request(app).get('/api/reports/budget-vs-actual?month=2026-03');
      const parent = report.body.parents.find((p) => p.category_id === parentExpenseCat.id);
      expect(parent.budgeted_cents).toBe(35000);
      expect(parent.actual_cents).toBe(3000);
      expect(parent.remaining_cents).toBe(32000);

      expect(report.body.totals.budgeted_cents).toBe(35000);
      expect(report.body.totals.remaining_cents).toBe(32000);
    });
  });

  describe('Cashflow projection', () => {
    it('excludes transfers from totals and projects planned and actual flows', async () => {
      // Confirmed expense + confirmed transfer in the range (transfer must be net zero)
      await request(app).post('/api/transactions').send({
        date: '2026-04-05',
        type: 'expense',
        amount_cents: 4000,
        category_id: leafExpenseCatA.id,
        account_id: checkingAcc.id,
        status: 'confirmed'
      });
      await request(app).post('/api/transactions').send({
        date: '2026-04-06',
        type: 'transfer',
        amount_cents: 30000,
        account_id: checkingAcc.id,
        to_account_id: savingsAcc.id,
        status: 'confirmed'
      });

      // Planned income and expense in the range
      await request(app).post('/api/transactions').send({
        date: '2026-04-10',
        type: 'income',
        amount_cents: 20000,
        category_id: incomeLeafCat.id,
        account_id: checkingAcc.id,
        status: 'planned'
      });
      await request(app).post('/api/transactions').send({
        date: '2026-04-12',
        type: 'expense',
        amount_cents: 5000,
        category_id: leafExpenseCatA.id,
        account_id: checkingAcc.id,
        status: 'planned'
      });

      const cashflow = await request(app).get('/api/reports/cashflow?from=2026-04-01&to=2026-04-30');
      expect(cashflow.status).toBe(200);

      const body = cashflow.body;
      // Opening = sum of initial balances of active accounts (no confirmed tx before range)
      expect(body.opening_balance_cents).toBe(250000);
      expect(body.actual.income_cents).toBe(0);
      expect(body.actual.expense_cents).toBe(4000);

      // Transfers excluded from income/expense totals...
      expect(body.planned.income_cents).toBe(20000);
      expect(body.planned.expense_cents).toBe(5000);

      // ...and cancel out in the running balance: 250000 - 4000 + 20000 - 5000
      expect(body.projected_closing_balance_cents).toBe(261000);

      const lastDay = body.series[body.series.length - 1];
      expect(lastDay.date).toBe('2026-04-30');
      expect(lastDay.balance_cents).toBe(261000);

      // Planned transactions must not affect confirmed account balances
      const balances = await request(app).get('/api/accounts/balances');
      const checking = balances.body.find((b) => b.id === checkingAcc.id);
      expect(checking.balance_cents).toBe(166000); // 200000 - 4000 expense - 30000 transfer out
    });

    it('rejects inverted or oversized date ranges', async () => {
      const inverted = await request(app).get('/api/reports/cashflow?from=2026-04-30&to=2026-04-01');
      expect(inverted.status).toBe(400);
      expect(inverted.body.error.code).toBe('INVALID_RANGE');

      const tooLong = await request(app).get('/api/reports/cashflow?from=2026-01-01&to=2027-06-01');
      expect(tooLong.status).toBe(400);
      expect(tooLong.body.error.code).toBe('RANGE_TOO_LONG');
    });
  });
});
