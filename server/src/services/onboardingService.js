import { getDb } from '../db.js';
import { getTodayYMD } from '../utils/date.js';
import { RecurringService } from './recurringService.js';

export class OnboardingService {
  /**
   * @param {import('better-sqlite3').Database} [db]
   */
  constructor(db) {
    this.db = db || getDb();
    this.recurringService = new RecurringService(this.db);
  }

  /**
   * Returns whether onboarding has been completed, the last active step,
   * and any persisted wizard payload (e.g. step 4 variable budgets).
   */
  getState() {
    const completedRow = this.db.prepare("SELECT value FROM settings WHERE key = 'onboarding_completed'").get();
    const stepRow = this.db.prepare("SELECT value FROM settings WHERE key = 'onboarding_step'").get();
    const dataRow = this.db.prepare("SELECT value FROM settings WHERE key = 'onboarding_step_data'").get();

    let data = null;
    if (dataRow?.value) {
      try {
        data = JSON.parse(dataRow.value);
      } catch {
        data = null;
      }
    }

    return {
      completed: completedRow?.value === 'true',
      step: stepRow?.value ? Number(stepRow.value) : 1,
      data
    };
  }

  /**
   * Persists progress after each onboarding step so closing the browser resumes seamlessly.
   * @param {number} step
   * @param {unknown} [data] optional structured wizard payload stored as JSON
   */
  saveStep(step, data) {
    this.db
      .prepare(`
        INSERT INTO settings (key, value)
        VALUES ('onboarding_step', ?)
        ON CONFLICT(key) DO UPDATE SET value = excluded.value
      `)
      .run(String(step));

    if (data !== undefined && data !== null) {
      this.db
        .prepare(`
          INSERT INTO settings (key, value)
          VALUES ('onboarding_step_data', ?)
          ON CONFLICT(key) DO UPDATE SET value = excluded.value
        `)
        .run(JSON.stringify(data));
    }

    return this.getState();
  }

  /**
   * Finalizes onboarding:
   * 1. Creates initial budgets (combining recurring item monthly equivalents and step 4 variable spending).
   * 2. Materializes planned transactions via recurrence generator.
   * 3. Sets onboarding_completed = 'true'.
   */
  completeOnboarding({ budgets = [] } = {}) {
    const today = getTodayYMD();
    const currentMonth = today.substring(0, 7); // 'YYYY-MM'

    const runCompletion = this.db.transaction(() => {
      // 1. Gather monthly-equivalent totals from recurring expense items
      const recurringItems = this.recurringService.listRecurring({ active: 1, type: 'expense' });
      const recurringBudgetsByCategory = new Map();

      for (const item of recurringItems) {
        if (item.category_id) {
          const current = recurringBudgetsByCategory.get(item.category_id) || 0;
          recurringBudgetsByCategory.set(item.category_id, current + item.monthly_equivalent_cents);
        }
      }

      // 2. Merge with explicit variable budgets passed from step 4
      const finalBudgets = new Map(recurringBudgetsByCategory);
      for (const b of budgets) {
        if (b.category_id && b.amount_cents >= 0) {
          // If explicitly provided, add to or override
          const current = finalBudgets.get(b.category_id) || 0;
          finalBudgets.set(b.category_id, current + b.amount_cents);
        }
      }

      // 3. Upsert budgets for current month
      const upsertBudgetStmt = this.db.prepare(`
        INSERT INTO budgets (category_id, month, amount_cents)
        VALUES (?, ?, ?)
        ON CONFLICT(category_id, month) DO UPDATE SET amount_cents = excluded.amount_cents
      `);

      for (const [categoryId, amountCents] of finalBudgets.entries()) {
        if (amountCents > 0) {
          upsertBudgetStmt.run(categoryId, currentMonth, amountCents);
        }
      }

      // 4. Run recurrence generator
      this.recurringService.generatePlannedTransactionsForHorizon({ referenceDate: today });

      // 5. Set settings flags
      this.db
        .prepare(`
          INSERT INTO settings (key, value)
          VALUES ('onboarding_completed', 'true')
          ON CONFLICT(key) DO UPDATE SET value = 'true'
        `)
        .run();

      this.db
        .prepare(`
          INSERT INTO settings (key, value)
          VALUES ('onboarding_step', '5')
          ON CONFLICT(key) DO UPDATE SET value = '5'
        `)
        .run();
    });

    runCompletion();
    return this.getState();
  }
}

export const onboardingService = new OnboardingService();
