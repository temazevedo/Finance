import { getDb } from '../db.js';
import { addMonthsToMonth, monthOf } from '../utils/date.js';
import { CategoryService } from './categoryService.js';

const MAX_LOOKBACK_MONTHS = 600;

export class BudgetService {
  /**
   * @param {import('better-sqlite3').Database} [db]
   */
  constructor(db) {
    this.db = db || getDb();
    this.categoryService = new CategoryService(this.db);
  }

  /**
   * Lists budgets for a month joined with category metadata.
   * @param {string} month - 'YYYY-MM'
   */
  listBudgets(month) {
    const rows = this.db
      .prepare(`
        SELECT
          b.category_id,
          b.month,
          b.amount_cents,
          c.name AS category_name,
          c.kind,
          c.budget_group,
          c.parent_id,
          c.archived AS category_archived,
          p.name AS parent_category_name
        FROM budgets b
        JOIN categories c ON c.id = b.category_id
        LEFT JOIN categories p ON p.id = c.parent_id
        WHERE b.month = ?
        ORDER BY p.name COLLATE NOCASE ASC, c.name COLLATE NOCASE ASC
      `)
      .all(month);

    return rows.map((row) => ({
      ...row,
      category_archived: Boolean(row.category_archived)
    }));
  }

  /**
   * Bulk upserts budgets for a month. Amounts of 0 are kept (explicit zero budgets).
   * Only non-archived leaf expense categories are accepted.
   * @param {string} month - 'YYYY-MM'
   * @param {Array<{category_id: number, amount_cents: number}>} budgets
   */
  upsertBudgets(month, budgets) {
    const upsertStmt = this.db.prepare(`
      INSERT INTO budgets (category_id, month, amount_cents)
      VALUES (?, ?, ?)
      ON CONFLICT(category_id, month) DO UPDATE SET amount_cents = excluded.amount_cents
    `);

    const runUpsert = this.db.transaction(() => {
      for (const { category_id, amount_cents } of budgets) {
        const category = this.db
          .prepare('SELECT id, kind, archived FROM categories WHERE id = ?')
          .get(category_id);

        if (!category || category.archived) {
          const error = new Error(`A categoria ${category_id} não existe ou está arquivada`);
          error.code = 'CATEGORY_NOT_FOUND';
          error.status = 400;
          throw error;
        }

        if (!this.categoryService.isLeafCategory(category_id)) {
          const error = new Error('Só é possível orçamentar categorias folha');
          error.code = 'NON_LEAF_CATEGORY';
          error.status = 400;
          throw error;
        }

        if (category.kind !== 'expense') {
          const error = new Error('Os orçamentos aplicam-se apenas a categorias de despesa');
          error.code = 'INVALID_CATEGORY_KIND';
          error.status = 400;
          throw error;
        }

        upsertStmt.run(category_id, month, amount_cents);
      }
    });

    runUpsert();
    return this.listBudgets(month);
  }

  /**
   * Builds cumulative carryover per category entering a target month.
   * carryover(M) = carryover(M-1) + budget(M-1) - actual(M-1), accumulated from the
   * earliest month having budgets or confirmed transactions. Future months after
   * the target are not considered.
   * @param {string} targetMonth - 'YYYY-MM'
   * @returns {Map<number, number>} category_id -> carryover cents
   */
  getCarryoverMap(targetMonth) {
    const earliestBudgetMonth = this.db.prepare('SELECT MIN(month) AS m FROM budgets').get()?.m || null;
    const earliestTx = this.db
      .prepare("SELECT MIN(date) AS d FROM transactions WHERE status = 'confirmed'")
      .get()?.d;

    let start = earliestBudgetMonth;
    if (earliestTx) {
      const txMonth = monthOf(earliestTx);
      if (!start || txMonth < start) start = txMonth;
    }

    const carryover = new Map();
    if (!start || start >= targetMonth) {
      return carryover;
    }

    const budgetByCatMonth = new Map();
    for (const row of this.db.prepare('SELECT category_id, month, amount_cents FROM budgets').all()) {
      budgetByCatMonth.set(`${row.category_id}|${row.month}`, row.amount_cents);
    }

    const actualByCatMonth = new Map();
    for (const row of this.db
      .prepare(`
        SELECT category_id, substr(date, 1, 7) AS month, SUM(amount_cents) AS total
        FROM transactions
        WHERE status = 'confirmed' AND type = 'expense' AND category_id IS NOT NULL
        GROUP BY category_id, substr(date, 1, 7)
      `)
      .all()) {
      actualByCatMonth.set(`${row.category_id}|${row.month}`, row.total);
    }

    const categoryIds = new Set();
    for (const key of budgetByCatMonth.keys()) categoryIds.add(Number(key.split('|')[0]));
    for (const key of actualByCatMonth.keys()) categoryIds.add(Number(key.split('|')[0]));

    let cur = start;
    let guard = 0;
    while (cur < targetMonth && guard < MAX_LOOKBACK_MONTHS) {
      for (const id of categoryIds) {
        const key = `${id}|${cur}`;
        const b = budgetByCatMonth.get(key) || 0;
        const a = actualByCatMonth.get(key) || 0;
        carryover.set(id, (carryover.get(id) || 0) + b - a);
      }
      cur = addMonthsToMonth(cur, 1);
      guard++;
    }

    return carryover;
  }
}

export const budgetService = new BudgetService();
