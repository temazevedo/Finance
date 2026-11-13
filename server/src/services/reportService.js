import { getDb } from '../db.js';
import { addDays, getMonthRange } from '../utils/date.js';
import { BudgetService } from './budgetService.js';

const MAX_CASHFLOW_DAYS = 370;

export class ReportService {
  /**
   * @param {import('better-sqlite3').Database} [db]
   */
  constructor(db) {
    this.db = db || getDb();
    this.budgetService = new BudgetService(this.db);
  }

  /**
   * Budget vs actual per leaf expense category for a month, including rollover carryover.
   * Roll-overo: available = budgeted + carryover; remaining = available - actual (confirmed).
   * @param {string} month - 'YYYY-MM'
   */
  getBudgetVsActual(month) {
    const { from, to } = getMonthRange(month);

    const budgetRows = this.db
      .prepare(`
        SELECT
          b.category_id,
          b.amount_cents,
          c.name AS category_name,
          c.kind,
          c.budget_group,
          c.parent_id,
          c.archived AS category_archived,
          p.id AS parent_category_id,
          p.name AS parent_category_name
        FROM budgets b
        JOIN categories c ON c.id = b.category_id
        LEFT JOIN categories p ON p.id = c.parent_id
        WHERE b.month = ?
      `)
      .all(month);

    const actualRows = this.db
      .prepare(`
        SELECT t.category_id, SUM(t.amount_cents) AS actual_cents
        FROM transactions t
        WHERE t.status = 'confirmed'
          AND t.type = 'expense'
          AND t.category_id IS NOT NULL
          AND t.date >= ? AND t.date <= ?
        GROUP BY t.category_id
      `)
      .all(from, to);

    const carryoverMap = this.budgetService.getCarryoverMap(month);

    const actualByCategory = new Map(actualRows.map((r) => [Number(r.category_id), r.actual_cents]));
    const budgetByCategory = new Map(budgetRows.map((r) => [Number(r.category_id), r.amount_cents]));
    const infoByCategory = new Map(budgetRows.map((r) => [Number(r.category_id), r]));

    // Include categories with activity or carryover even without a budget set this month
    const categoryIds = new Set([
      ...budgetByCategory.keys(),
      ...actualByCategory.keys(),
      ...carryoverMap.keys()
    ]);

    const categories = [];
    for (const id of categoryIds) {
      const info = infoByCategory.get(id);
      if (!info || info.kind !== 'expense') continue; // only expense categories are budgetable

      const budgeted = budgetByCategory.get(id) || 0;
      const carryover = carryoverMap.get(id) || 0;
      const available = budgeted + carryover;
      const actual = actualByCategory.get(id) || 0;
      const remaining = available - actual;

      categories.push({
        category_id: id,
        category_name: info.category_name,
        parent_category_id: info.parent_category_id,
        parent_category_name: info.parent_category_name,
        budget_group: info.budget_group,
        category_archived: Boolean(info.category_archived),
        has_budget: budgetByCategory.has(id),
        budgeted_cents: budgeted,
        carryover_cents: carryover,
        available_cents: available,
        actual_cents: actual,
        remaining_cents: remaining,
        is_overspent: remaining < 0
      });
    }

    categories.sort((a, b) => {
      const pa = a.parent_category_name || a.category_name;
      const pb = b.parent_category_name || b.category_name;
      if (pa !== pb) return pa.localeCompare(pb, 'pt');
      return a.category_name.localeCompare(b.category_name, 'pt');
    });

    // Parent aggregation: parents are computed by summing their leaf children
    const parentsById = new Map();
    for (const cat of categories) {
      if (cat.parent_category_id == null) continue;
      if (!parentsById.has(cat.parent_category_id)) {
        parentsById.set(cat.parent_category_id, {
          category_id: cat.parent_category_id,
          category_name: cat.parent_category_name,
          budgeted_cents: 0,
          carryover_cents: 0,
          available_cents: 0,
          actual_cents: 0,
          remaining_cents: 0
        });
      }
      const parent = parentsById.get(cat.parent_category_id);
      parent.budgeted_cents += cat.budgeted_cents;
      parent.carryover_cents += cat.carryover_cents;
      parent.available_cents += cat.available_cents;
      parent.actual_cents += cat.actual_cents;
      parent.remaining_cents += cat.remaining_cents;
    }

    const totals = categories.reduce(
      (acc, cat) => ({
        budgeted_cents: acc.budgeted_cents + cat.budgeted_cents,
        carryover_cents: acc.carryover_cents + cat.carryover_cents,
        available_cents: acc.available_cents + cat.available_cents,
        actual_cents: acc.actual_cents + cat.actual_cents,
        remaining_cents: acc.remaining_cents + cat.remaining_cents
      }),
      { budgeted_cents: 0, carryover_cents: 0, available_cents: 0, actual_cents: 0, remaining_cents: 0 }
    );

    return {
      month,
      categories,
      parents: [...parentsById.values()].sort((a, b) => a.category_name.localeCompare(b.category_name, 'pt')),
      totals: { ...totals, is_overspent: totals.remaining_cents < 0 }
    };
  }

  /**
   * Cashflow projection over a date range: opening confirmed balance, actual and
   * planned flows within the range, and a daily running balance series.
   * Transfers between own accounts cancel out and are excluded from income/expense totals.
   * @param {string} fromStr - 'YYYY-MM-DD' (inclusive)
   * @param {string} toStr - 'YYYY-MM-DD' (inclusive)
   */
  getCashflow(fromStr, toStr) {
    if (fromStr > toStr) {
      const error = new Error('A data inicial deve ser anterior ou igual à data final');
      error.code = 'INVALID_RANGE';
      error.status = 400;
      throw error;
    }

    // Range length guard (max ~1 year)
    let guard = 0;
    let probe = fromStr;
    while (probe < toStr && guard < MAX_CASHFLOW_DAYS + 1) {
      probe = addDays(probe, 1);
      guard++;
    }
    if (toStr > probe) {
      const error = new Error(`O intervalo não pode exceder ${MAX_CASHFLOW_DAYS} dias`);
      error.code = 'RANGE_TOO_LONG';
      error.status = 400;
      throw error;
    }

    // Opening balance: initial balances of active accounts + all confirmed flows before 'from'
    const initialTotal =
      this.db.prepare('SELECT COALESCE(SUM(initial_balance_cents), 0) AS t FROM accounts WHERE archived = 0').get()
        ?.t || 0;
    const confirmedBefore =
      this.db
        .prepare(`
          SELECT COALESCE(SUM(
            CASE WHEN type = 'income' THEN amount_cents
                 WHEN type = 'expense' THEN -amount_cents
                 ELSE 0 END
          ), 0) AS t
          FROM transactions
          WHERE status = 'confirmed' AND date < ?
        `)
        .get(fromStr)?.t || 0;
    const openingBalanceCents = initialTotal + confirmedBefore;

    // All flows in range (both statuses), grouped by date for the daily series
    const rangeRows = this.db
      .prepare(`
        SELECT date, type, amount_cents, status
        FROM transactions
        WHERE date >= ? AND date <= ?
        ORDER BY date ASC, id ASC
      `)
      .all(fromStr, toStr);

    const flowsByDate = new Map();
    const actual = { income_cents: 0, expense_cents: 0, net_cents: 0 };
    const planned = { income_cents: 0, expense_cents: 0, net_cents: 0 };

    for (const row of rangeRows) {
      let signed = 0;
      let bucket = null;
      if (row.type === 'income') {
        signed = row.amount_cents;
        bucket = row.status === 'confirmed' ? actual : planned;
        bucket.income_cents += row.amount_cents;
      } else if (row.type === 'expense') {
        signed = -row.amount_cents;
        bucket = row.status === 'confirmed' ? actual : planned;
        bucket.expense_cents += row.amount_cents;
      } else {
        // Transfers move money between own accounts: net zero, excluded from totals
        continue;
      }
      bucket.net_cents += signed;
      flowsByDate.set(row.date, (flowsByDate.get(row.date) || 0) + signed);
    }
    actual.net_cents = actual.income_cents - actual.expense_cents;
    planned.net_cents = planned.income_cents - planned.expense_cents;

    // Daily walking series
    const series = [];
    let running = openingBalanceCents;
    let cur = fromStr;
    let dayGuard = 0;
    while (cur <= toStr && dayGuard <= MAX_CASHFLOW_DAYS) {
      const change = flowsByDate.get(cur) || 0;
      running += change;
      series.push({ date: cur, net_change_cents: change, balance_cents: running });
      cur = addDays(cur, 1);
      dayGuard++;
    }

    return {
      from: fromStr,
      to: toStr,
      opening_balance_cents: openingBalanceCents,
      actual,
      planned,
      projected_closing_balance_cents: running,
      series
    };
  }
}

export const reportService = new ReportService();
