import { getDb } from '../db.js';
import { addDays, getMonthlyEquivalentCents, getOccurrences, getTodayYMD } from '../utils/date.js';
import { AccountService } from './accountService.js';
import { CategoryService } from './categoryService.js';

export class RecurringService {
  /**
   * @param {import('better-sqlite3').Database} [db]
   */
  constructor(db) {
    this.db = db || getDb();
    this.accountService = new AccountService(this.db);
    this.categoryService = new CategoryService(this.db);
  }

  /**
   * Lists recurring items with metadata and monthly-equivalent amounts.
   */
  listRecurring({ type, active } = {}) {
    const whereConditions = [];
    const params = [];

    if (type) {
      whereConditions.push('r.type = ?');
      params.push(type);
    }
    if (active !== undefined) {
      whereConditions.push('r.active = ?');
      params.push(active);
    }

    const whereClause = whereConditions.length > 0 ? `WHERE ${whereConditions.join(' AND ')}` : '';

    const sql = `
      SELECT
        r.*,
        a.name AS account_name,
        toa.name AS to_account_name,
        c.name AS category_name,
        p.name AS parent_category_name
      FROM recurring_items r
      JOIN accounts a ON r.account_id = a.id
      LEFT JOIN accounts toa ON r.to_account_id = toa.id
      LEFT JOIN categories c ON r.category_id = c.id
      LEFT JOIN categories p ON c.parent_id = p.id
      ${whereClause}
      ORDER BY r.active DESC, r.type ASC, r.name ASC
    `;

    const rows = this.db.prepare(sql).all(...params);
    return rows.map((row) => ({
      ...row,
      is_estimate: Boolean(row.is_estimate),
      active: Boolean(row.active),
      monthly_equivalent_cents: getMonthlyEquivalentCents(row.amount_cents, row.frequency)
    }));
  }

  /**
   * Retrieves a single recurring item by ID.
   */
  getRecurringById(id) {
    const sql = `
      SELECT
        r.*,
        a.name AS account_name,
        toa.name AS to_account_name,
        c.name AS category_name,
        p.name AS parent_category_name
      FROM recurring_items r
      JOIN accounts a ON r.account_id = a.id
      LEFT JOIN accounts toa ON r.to_account_id = toa.id
      LEFT JOIN categories c ON r.category_id = c.id
      LEFT JOIN categories p ON c.parent_id = p.id
      WHERE r.id = ?
    `;
    const row = this.db.prepare(sql).get(id);
    if (!row) return null;
    return {
      ...row,
      is_estimate: Boolean(row.is_estimate),
      active: Boolean(row.active),
      monthly_equivalent_cents: getMonthlyEquivalentCents(row.amount_cents, row.frequency)
    };
  }

  /**
   * Creates a new recurring item and materializes upcoming planned transactions.
   */
  createRecurring(data) {
    // Validate account
    const account = this.accountService.getAccountById(data.account_id);
    if (!account) {
      const error = new Error('A conta indicada não existe');
      error.code = 'INVALID_ACCOUNT';
      error.status = 400;
      throw error;
    }

    if (data.type === 'transfer') {
      const toAccount = this.accountService.getAccountById(data.to_account_id);
      if (!toAccount) {
        const error = new Error('A conta de destino não existe');
        error.code = 'INVALID_ACCOUNT';
        error.status = 400;
        throw error;
      }
      data.category_id = null;
    } else {
      if (!this.categoryService.isLeafCategory(data.category_id)) {
        const error = new Error('Só é permitido associar transações recorrentes a categorias folha');
        error.code = 'NON_LEAF_CATEGORY';
        error.status = 400;
        throw error;
      }
      data.to_account_id = null;
    }

    const stmt = this.db.prepare(`
      INSERT INTO recurring_items (
        type, name, category_id, account_id, to_account_id,
        amount_cents, is_estimate, frequency, start_date, end_date, active
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const result = stmt.run(
      data.type,
      data.name.trim(),
      data.category_id,
      data.account_id,
      data.to_account_id,
      data.amount_cents,
      data.is_estimate ? 1 : 0,
      data.frequency,
      data.start_date,
      data.end_date || null,
      data.active !== undefined ? (data.active ? 1 : 0) : 1
    );

    const createdId = result.lastInsertRowid;

    // Run generator for the new item
    this.generatePlannedTransactionsForHorizon();

    return this.getRecurringById(createdId);
  }

  /**
   * Updates a recurring item.
   * Removes unconfirmed future planned transactions and regenerates them. Confirmed ones are never touched.
   */
  updateRecurring(id, updates) {
    const existing = this.getRecurringById(id);
    if (!existing) {
      return null;
    }

    const merged = { ...existing, ...updates };

    if (merged.type === 'transfer') {
      if (!merged.to_account_id) {
        const error = new Error('A conta de destino é obrigatória para transferências');
        error.code = 'INVALID_TRANSFER';
        error.status = 400;
        throw error;
      }
      merged.category_id = null;
    } else {
      if (!this.categoryService.isLeafCategory(merged.category_id)) {
        const error = new Error('Só é permitido associar a categorias folha');
        error.code = 'NON_LEAF_CATEGORY';
        error.status = 400;
        throw error;
      }
      merged.to_account_id = null;
    }

    const today = getTodayYMD();

    const runUpdate = this.db.transaction(() => {
      // 1. Update recurring item record
      this.db
        .prepare(`
          UPDATE recurring_items SET
            type = ?,
            name = ?,
            category_id = ?,
            account_id = ?,
            to_account_id = ?,
            amount_cents = ?,
            is_estimate = ?,
            frequency = ?,
            start_date = ?,
            end_date = ?,
            active = ?
          WHERE id = ?
        `)
        .run(
          merged.type,
          merged.name.trim(),
          merged.category_id,
          merged.account_id,
          merged.to_account_id,
          merged.amount_cents,
          merged.is_estimate ? 1 : 0,
          merged.frequency,
          merged.start_date,
          merged.end_date || null,
          merged.active ? 1 : 0,
          id
        );

      // 2. Remove future planned transactions for this recurring item (leave confirmed ones intact)
      this.db
        .prepare(`
          DELETE FROM transactions
          WHERE recurring_id = ?
            AND status = 'planned'
            AND date >= ?
        `)
        .run(id, today);

      // 3. Regenerate future occurrences if still active
      if (merged.active) {
        this.generateForItem(merged, today, 60);
      }
    });

    runUpdate();

    return this.getRecurringById(id);
  }

  /**
   * Deactivates a recurring item and removes future unconfirmed planned occurrences.
   */
  deactivateRecurring(id) {
    return this.updateRecurring(id, { active: 0 });
  }

  /**
   * Materializes planned transactions for all active recurring items over a rolling horizon (default 60 days).
   * Idempotent: Uses INSERT ... ON CONFLICT(recurring_id, date) DO NOTHING.
   * Excludes skipped occurrences recorded in skipped_occurrences table.
   *
   * @param {Object} options
   * @param {number} [options.horizonDays=60]
   * @param {string} [options.referenceDate=getTodayYMD()]
   * @returns {{ generatedCount: number }}
   */
  generatePlannedTransactionsForHorizon({
    horizonDays = 60,
    referenceDate = getTodayYMD()
  } = {}) {
    const activeItems = this.db.prepare('SELECT * FROM recurring_items WHERE active = 1').all();
    let totalGenerated = 0;

    const runGeneration = this.db.transaction(() => {
      for (const item of activeItems) {
        totalGenerated += this.generateForItem(item, referenceDate, horizonDays);
      }

      // Record generator last run date in settings
      this.db
        .prepare(`
          INSERT INTO settings (key, value)
          VALUES ('generator_last_run', ?)
          ON CONFLICT(key) DO UPDATE SET value = excluded.value
        `)
        .run(referenceDate);
    });

    runGeneration();
    return { generatedCount: totalGenerated };
  }

  /**
   * Internal generator helper for a single recurring item.
   * @private
   */
  generateForItem(item, referenceDate, horizonDays) {
    const horizonEndDate = addDays(referenceDate, horizonDays);
    const allOccurrences = getOccurrences(item.start_date, item.frequency, item.end_date, horizonEndDate);

    // Filter occurrences: must be >= referenceDate (or today) and not in skipped_occurrences
    const validOccurrences = allOccurrences.filter((date) => date >= referenceDate);
    if (validOccurrences.length === 0) return 0;

    // Check skipped occurrences
    const skippedRows = this.db
      .prepare('SELECT date FROM skipped_occurrences WHERE recurring_id = ?')
      .all(item.id);
    const skippedDates = new Set(skippedRows.map((r) => r.date));

    let count = 0;
    const insertStmt = this.db.prepare(`
      INSERT INTO transactions (
        date, type, amount_cents, account_id, to_account_id,
        category_id, name, status, recurring_id
      ) VALUES (?, ?, ?, ?, ?, ?, ?, 'planned', ?)
      ON CONFLICT(recurring_id, date) WHERE recurring_id IS NOT NULL DO NOTHING
    `);

    for (const date of validOccurrences) {
      if (!skippedDates.has(date)) {
        const result = insertStmt.run(
          date,
          item.type,
          item.amount_cents,
          item.account_id,
          item.to_account_id || null,
          item.category_id || null,
          item.name,
          item.id
        );
        if (result.changes > 0) {
          count++;
        }
      }
    }

    return count;
  }

  /**
   * Calculates monthly-equivalent totals and surplus for active recurring items.
   */
  getMonthlySummary() {
    const items = this.listRecurring({ active: 1 });

    let incomeCents = 0;
    let expenseCents = 0;

    for (const item of items) {
      if (item.type === 'income') {
        incomeCents += item.monthly_equivalent_cents;
      } else if (item.type === 'expense') {
        expenseCents += item.monthly_equivalent_cents;
      }
      // Transfers don't count towards income or expense
    }

    const surplusCents = incomeCents - expenseCents;

    return {
      income_cents: incomeCents,
      expense_cents: expenseCents,
      surplus_cents: surplusCents,
      items_count: items.length
    };
  }
}

export const recurringService = new RecurringService();
