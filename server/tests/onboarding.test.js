import request from 'supertest';
import { describe, it, expect, beforeEach } from 'vitest';
import { getDb } from '../src/db.js';
import { app } from '../src/index.js';

describe('Onboarding API (/api/onboarding)', () => {
  const db = getDb();

  beforeEach(() => {
    db.prepare('DELETE FROM skipped_occurrences').run();
    db.prepare('DELETE FROM transactions').run();
    db.prepare('DELETE FROM recurring_items').run();
    db.prepare('DELETE FROM budgets').run();
    db.prepare('DELETE FROM settings').run();
  });

  it('tracks resumable onboarding progress step by step', async () => {
    // Initial state: not completed, step 1
    const resInitial = await request(app).get('/api/onboarding/state');
    expect(resInitial.status).toBe(200);
    expect(resInitial.body.completed).toBe(false);
    expect(resInitial.body.step).toBe(1);

    // Save step 2
    const resStep2 = await request(app).put('/api/onboarding/step').send({ step: 2 });
    expect(resStep2.status).toBe(200);
    expect(resStep2.body.step).toBe(2);

    // Verify persisted
    const resCheck = await request(app).get('/api/onboarding/state');
    expect(resCheck.body.step).toBe(2);
  });

  it('persists optional wizard data JSON alongside the step', async () => {
    const payload = { variable_budgets: [{ category_id: 12, amount_cents: 35000 }] };

    await request(app).put('/api/onboarding/step').send({ step: 4, data: payload });

    const res = await request(app).get('/api/onboarding/state');
    expect(res.body.step).toBe(4);
    expect(res.body.data).toEqual(payload);
  });

  it('finalizes onboarding, sets completion flag, and initializes budgets', async () => {
    const leafCat = db.prepare('SELECT id FROM categories WHERE parent_id IS NOT NULL LIMIT 1').get();

    const resComplete = await request(app).post('/api/onboarding/complete').send({
      budgets: [
        {
          category_id: leafCat.id,
          amount_cents: 35000 // 350,00 €
        }
      ]
    });

    expect(resComplete.status).toBe(200);
    expect(resComplete.body.completed).toBe(true);

    // Verify budget was created in database
    const budget = db.prepare('SELECT * FROM budgets WHERE category_id = ?').get(leafCat.id);
    expect(budget).toBeDefined();
    expect(budget.amount_cents).toBe(35000);

    // Verify setting flag
    const flag = db.prepare("SELECT value FROM settings WHERE key = 'onboarding_completed'").get();
    expect(flag.value).toBe('true');
  });
});
