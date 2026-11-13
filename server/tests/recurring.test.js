import request from 'supertest';
import { describe, it, expect, beforeEach } from 'vitest';
import { getDb } from '../src/db.js';
import { app } from '../src/index.js';
import { getMonthlyEquivalentCents, getOccurrences } from '../src/utils/date.js';

describe('Recurring Items & Recurrence Generator', () => {
  const db = getDb();
  let checkingAcc;
  let savingsAcc;
  let leafCat;

  beforeEach(async () => {
    db.prepare('DELETE FROM skipped_occurrences').run();
    db.prepare('DELETE FROM transactions').run();
    db.prepare('DELETE FROM recurring_items').run();
    db.prepare('DELETE FROM accounts').run();

    // Setup accounts
    checkingAcc = (
      await request(app)
        .post('/api/accounts')
        .send({ name: 'Conta Ordem', type: 'checking', initial_balance_cents: 100000 })
    ).body;

    savingsAcc = (
      await request(app)
        .post('/api/accounts')
        .send({ name: 'Conta Poupança', type: 'savings', initial_balance_cents: 50000 })
    ).body;

    // Leaf category
    leafCat = db.prepare('SELECT id FROM categories WHERE parent_id = 1 LIMIT 1').get();
  });

  describe('Occurrence Generator Date Math', () => {
    it('generates correct occurrences for all frequencies', () => {
      // Weekly: 4 weeks
      const weekly = getOccurrences('2026-05-01', 'weekly', null, '2026-05-22');
      expect(weekly).toEqual(['2026-05-01', '2026-05-08', '2026-05-15', '2026-05-22']);

      // Biweekly: 2 occurrences in 15 days
      const biweekly = getOccurrences('2026-05-01', 'biweekly', null, '2026-05-16');
      expect(biweekly).toEqual(['2026-05-01', '2026-05-15']);

      // Monthly: anchor on the 15th
      const monthly = getOccurrences('2026-01-15', 'monthly', null, '2026-04-16');
      expect(monthly).toEqual(['2026-01-15', '2026-02-15', '2026-03-15', '2026-04-15']);

      // Bimonthly
      const bimonthly = getOccurrences('2026-01-10', 'bimonthly', null, '2026-06-01');
      expect(bimonthly).toEqual(['2026-01-10', '2026-03-10', '2026-05-10']);

      // Quarterly
      const quarterly = getOccurrences('2026-01-01', 'quarterly', null, '2026-07-02');
      expect(quarterly).toEqual(['2026-01-01', '2026-04-01', '2026-07-01']);

      // Semiannual
      const semiannual = getOccurrences('2026-01-01', 'semiannual', null, '2026-07-02');
      expect(semiannual).toEqual(['2026-01-01', '2026-07-01']);

      // Annual
      const annual = getOccurrences('2026-01-01', 'annual', null, '2027-01-02');
      expect(annual).toEqual(['2026-01-01', '2027-01-01']);
    });

    it('clamps month-end correctly and restores anchor day on longer months', () => {
      // Anchored on 31st January
      const occurrences = getOccurrences('2026-01-31', 'monthly', null, '2026-04-30');
      // Jan 31 -> Feb 28 (clamped) -> Mar 31 (restored to 31) -> Apr 30 (clamped)
      expect(occurrences).toEqual(['2026-01-31', '2026-02-28', '2026-03-31', '2026-04-30']);
    });

    it('respects end_date cutoff', () => {
      const occurrences = getOccurrences('2026-01-01', 'monthly', '2026-02-15', '2026-06-01');
      expect(occurrences).toEqual(['2026-01-01', '2026-02-01']);
    });

    it('computes monthly equivalent cents accurately according to spec', () => {
      expect(getMonthlyEquivalentCents(10000, 'monthly')).toBe(10000);
      expect(getMonthlyEquivalentCents(12000, 'annual')).toBe(1000); // 12000 / 12
      expect(getMonthlyEquivalentCents(3000, 'quarterly')).toBe(1000); // 3000 / 3
      expect(getMonthlyEquivalentCents(2000, 'bimonthly')).toBe(1000); // 2000 / 2
      expect(getMonthlyEquivalentCents(6000, 'semiannual')).toBe(1000); // 6000 / 6
      expect(getMonthlyEquivalentCents(1200, 'weekly')).toBe(5200); // 1200 * 52 / 12
      expect(getMonthlyEquivalentCents(1200, 'biweekly')).toBe(2600); // 1200 * 26 / 12
    });
  });

  describe('CRUD & Materialization', () => {
    it('creates recurring expense and automatically materializes planned transactions', async () => {
      const today = new Date().toISOString().split('T')[0];

      const res = await request(app).post('/api/recurring').send({
        type: 'expense',
        name: 'Gás Natural',
        account_id: checkingAcc.id,
        category_id: leafCat.id,
        amount_cents: 3500,
        frequency: 'monthly',
        start_date: today,
        is_estimate: 1
      });

      expect(res.status).toBe(201);
      expect(res.body.id).toBeDefined();
      expect(res.body.is_estimate).toBe(true);

      // Verify that planned transactions were generated
      const planned = db
        .prepare("SELECT * FROM transactions WHERE recurring_id = ? AND status = 'planned'")
        .all(res.body.id);

      expect(planned.length).toBeGreaterThan(0);
      expect(planned[0].amount_cents).toBe(3500);
      expect(planned[0].type).toBe('expense');
    });

    it('creates recurring transfer between accounts', async () => {
      const today = new Date().toISOString().split('T')[0];

      const res = await request(app).post('/api/recurring').send({
        type: 'transfer',
        name: 'Poupança Automática',
        account_id: checkingAcc.id,
        to_account_id: savingsAcc.id,
        amount_cents: 15000,
        frequency: 'monthly',
        start_date: today
      });

      expect(res.status).toBe(201);
      expect(res.body.type).toBe('transfer');
      expect(res.body.to_account_id).toBe(savingsAcc.id);
      expect(res.body.category_id).toBeNull();

      // Check planned transactions
      const planned = db
        .prepare("SELECT * FROM transactions WHERE recurring_id = ? AND status = 'planned'")
        .all(res.body.id);

      expect(planned.length).toBeGreaterThan(0);
      expect(planned[0].type).toBe('transfer');
      expect(planned[0].to_account_id).toBe(savingsAcc.id);
    });

    it('is strictly idempotent when running generator multiple times', async () => {
      const today = new Date().toISOString().split('T')[0];

      const res = await request(app).post('/api/recurring').send({
        type: 'expense',
        name: 'Água',
        account_id: checkingAcc.id,
        category_id: leafCat.id,
        amount_cents: 2000,
        frequency: 'monthly',
        start_date: today
      });

      const count1 = db
        .prepare('SELECT COUNT(*) as c FROM transactions WHERE recurring_id = ?')
        .get(res.body.id).c;

      // Manually trigger startup generator or post another item
      await request(app).post('/api/recurring').send({
        type: 'income',
        name: 'Salário',
        account_id: checkingAcc.id,
        category_id: leafCat.id,
        amount_cents: 150000,
        frequency: 'monthly',
        start_date: today
      });

      const count2 = db
        .prepare('SELECT COUNT(*) as c FROM transactions WHERE recurring_id = ?')
        .get(res.body.id).c;

      // Água count must remain identical! No duplicates!
      expect(count1).toBe(count2);
    });

    it('regenerates future planned items when recurring item is edited without modifying confirmed items', async () => {
      const today = new Date().toISOString().split('T')[0];

      const res = await request(app).post('/api/recurring').send({
        type: 'expense',
        name: 'Eletricidade',
        account_id: checkingAcc.id,
        category_id: leafCat.id,
        amount_cents: 5000,
        frequency: 'monthly',
        start_date: today
      });
      const recId = res.body.id;

      // Confirm the first occurrence with an edited amount (e.g. 52,50€)
      const firstPlanned = db
        .prepare('SELECT * FROM transactions WHERE recurring_id = ? ORDER BY date ASC LIMIT 1')
        .get(recId);

      await request(app).patch(`/api/transactions/${firstPlanned.id}`).send({
        status: 'confirmed',
        amount_cents: 5250
      });

      // Update recurring item to 6000 cents
      await request(app).patch(`/api/recurring/${recId}`).send({
        amount_cents: 6000
      });

      // Verify confirmed transaction was NOT touched
      const confirmed = db.prepare('SELECT * FROM transactions WHERE id = ?').get(firstPlanned.id);
      expect(confirmed.status).toBe('confirmed');
      expect(confirmed.amount_cents).toBe(5250);

      // Verify future planned items now reflect 6000 cents
      const futurePlanned = db
        .prepare("SELECT * FROM transactions WHERE recurring_id = ? AND status = 'planned'")
        .all(recId);

      for (const p of futurePlanned) {
        expect(p.amount_cents).toBe(6000);
      }
    });

    it('removes future planned transactions when recurring item is deactivated', async () => {
      const today = new Date().toISOString().split('T')[0];

      const res = await request(app).post('/api/recurring').send({
        type: 'expense',
        name: 'Ginásio',
        account_id: checkingAcc.id,
        category_id: leafCat.id,
        amount_cents: 3000,
        frequency: 'monthly',
        start_date: today
      });
      const recId = res.body.id;

      // Deactivate
      await request(app).delete(`/api/recurring/${recId}`);

      const remainingPlanned = db
        .prepare("SELECT COUNT(*) as c FROM transactions WHERE recurring_id = ? AND status = 'planned'")
        .get(recId).c;

      expect(remainingPlanned).toBe(0);
    });

    it('records skipped occurrences on delete and the generator does not recreate them', async () => {
      const today = new Date().toISOString().split('T')[0];

      const res = await request(app).post('/api/recurring').send({
        type: 'expense',
        name: 'Internet',
        account_id: checkingAcc.id,
        category_id: leafCat.id,
        amount_cents: 4000,
        frequency: 'monthly',
        start_date: today
      });
      const recId = res.body.id;

      const plannedBefore = db
        .prepare("SELECT * FROM transactions WHERE recurring_id = ? AND status = 'planned'")
        .all(recId);
      expect(plannedBefore.length).toBeGreaterThan(0);

      // Delete the first planned occurrence -> must be recorded as skipped
      await request(app).delete(`/api/transactions/${plannedBefore[0].id}`);

      const skipped = db
        .prepare('SELECT * FROM skipped_occurrences WHERE recurring_id = ? AND date = ?')
        .get(recId, plannedBefore[0].date);
      expect(skipped).toBeDefined();

      // Trigger the generator again (edit regenerates future occurrences)
      await request(app).patch(`/api/recurring/${recId}`).send({ amount_cents: res.body.amount_cents });

      const plannedAfter = db
        .prepare("SELECT * FROM transactions WHERE recurring_id = ? AND status = 'planned'")
        .all(recId);
      const plannedDates = plannedAfter.map((p) => p.date);

      // The skipped date must not come back, and no duplicates were created
      expect(plannedDates).not.toContain(plannedBefore[0].date);
      expect(new Set(plannedDates).size).toBe(plannedDates.length);
      expect(plannedAfter.length).toBe(plannedBefore.length - 1);
    });

    it('returns monthly summary with surplus calculation', async () => {
      const today = new Date().toISOString().split('T')[0];

      // Income: 2000€ monthly
      await request(app).post('/api/recurring').send({
        type: 'income',
        name: 'Salário Base',
        account_id: checkingAcc.id,
        category_id: leafCat.id,
        amount_cents: 200000,
        frequency: 'monthly',
        start_date: today
      });

      // Expense 1: 500€ monthly
      await request(app).post('/api/recurring').send({
        type: 'expense',
        name: 'Renda',
        account_id: checkingAcc.id,
        category_id: leafCat.id,
        amount_cents: 50000,
        frequency: 'monthly',
        start_date: today
      });

      // Expense 2: 1200€ annual (100€ / month)
      await request(app).post('/api/recurring').send({
        type: 'expense',
        name: 'Seguro Automóvel',
        account_id: checkingAcc.id,
        category_id: leafCat.id,
        amount_cents: 120000,
        frequency: 'annual',
        start_date: today
      });

      const res = await request(app).get('/api/recurring/summary');
      expect(res.status).toBe(200);

      expect(res.body.income_cents).toBe(200000);
      expect(res.body.expense_cents).toBe(60000); // 500€ + 100€
      expect(res.body.surplus_cents).toBe(140000); // 2000€ - 600€ = 1400€
    });
  });
});
