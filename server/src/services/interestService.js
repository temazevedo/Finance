import { getDb } from '../db.js';
import { getTodayYMD, addMonthsToMonth, getMonthRange, isValidDateString } from '../utils/date.js';

/**
 * Auto-generates confirmed interest income transactions for investment accounts.
 *
 * Rules:
 * - Only accounts with type='investment', a positive interest_rate and an
 *   interest_period ('monthly' | 'annual') are considered.
 * - Monthly accounts: interest for period 'YYYY-MM' is posted as a confirmed
 *   income transaction dated the last day of that month, amount =
 *   round(balance_at_period_end * rate/100 / 12).
 * - Annual accounts: interest for period 'YYYY' is posted dated Dec 31 of that
 *   year, amount = round(balance_at_period_end * rate/100).
 * - Only fully elapsed periods are posted (period end < today), so the first
 *   run after setting a rate posts the most recently completed period only.
 * - Idempotent via the interest_postings table (UNIQUE(account_id, period)).
 * - balance_at_period_end = initial_balance + confirmed movements up to the
 *   period end date (same formula as accountService.getAccountBalances).
 */
export class InterestService {
  constructor(db) {
    this.db = db || getDb();
  }

  /**
   * Posts interest for every eligible account. Safe to run daily.
   * @param {string} [referenceDate]
   * @returns {{ postedCount: number, skipped: number }}
   */
  generateInterestPostings(referenceDate = getTodayYMD()) {
    if (!isValidDateString(referenceDate)) {
      throw new Error('Data de referência inválida');
    }

    const accounts = this.db
      .prepare(
        `SELECT id, name, type, interest_rate, interest_period, initial_balance_cents
         FROM accounts
         WHERE archived = 0 AND type = 'investment'
           AND interest_rate IS NOT NULL AND interest_rate > 0
           AND interest_period IN ('monthly', 'annual')`
      )
      .all();

    let postedCount = 0;
    let skipped = 0;

    const run = this.db.transaction(() => {
      for (const account of accounts) {
        const periods = this.getPendingPeriods(account, referenceDate);
        for (const period of periods) {
          const posted = this.postInterestForPeriod(account, period);
          if (posted) {
            postedCount++;
          } else {
            skipped++;
          }
        }
      }
    });
    run();

    return { postedCount, skipped };
  }

  /**
   * Returns the not-yet-posted, fully elapsed periods for an account.
   * Only the most recent completed period is considered (interest is posted
   * once per period; older gaps are ignored so historic rates are not
   * retro-applied).
   * @private
   */
  getPendingPeriods(account, referenceDate) {
    if (account.interest_period === 'monthly') {
      // Last fully elapsed month
      const currentMonth = referenceDate.slice(0, 7);
      const period = addMonthsToMonth(currentMonth, -1);
      const { to: periodEnd } = getMonthRange(period);
      if (periodEnd >= referenceDate) return [];
      return this.isPosted(account.id, period) ? [] : [{ period, periodEnd }];
    }

    // Annual: last fully elapsed year
    const currentYear = Number(referenceDate.slice(0, 4));
    const period = String(currentYear - 1);
    const periodEnd = `${period}-12-31`;
    if (periodEnd >= referenceDate) return [];
    return this.isPosted(account.id, period) ? [] : [{ period, periodEnd }];
  }

  /**
   * @private
   */
  isPosted(accountId, period) {
    return Boolean(
      this.db.prepare('SELECT 1 FROM interest_postings WHERE account_id = ? AND period = ?').get(accountId, period)
    );
  }

  /**
   * Posts one interest income transaction for the given period.
   * @private
   * @returns {boolean} true if posted, false if skipped (zero amount)
   */
  postInterestForPeriod(account, { period, periodEnd }) {
    const balanceCents = this.balanceAtDate(account.id, account.initial_balance_cents, periodEnd);
    const rate = account.interest_rate / 100;
    const divisor = account.interest_period === 'monthly' ? 12 : 1;
    const amountCents = Math.round((balanceCents * rate) / divisor);

    if (amountCents <= 0) {
      // Record zero periods as posted to avoid re-evaluating them every run
      this.db
        .prepare('INSERT INTO interest_postings (account_id, period, amount_cents) VALUES (?, ?, 0)')
        .run(account.id, period);
      return false;
    }

    const categoryId = this.findInterestCategoryId();

    this.db
      .prepare(
        `INSERT INTO transactions (date, type, amount_cents, account_id, category_id, name, status)
         VALUES (?, 'income', ?, ?, ?, ?, 'confirmed')`
      )
      .run(periodEnd, amountCents, account.id, categoryId, `Juros — ${account.name}`);

    this.db
      .prepare('INSERT INTO interest_postings (account_id, period, amount_cents) VALUES (?, ?, ?)')
      .run(account.id, period, amountCents);

    return true;
  }

  /**
   * Balance at a given date: initial balance + confirmed income - confirmed
   * expenses - outgoing transfers + incoming transfers, dated up to `date`.
   * Same formula as accountService.getAccountBalances.
   * @private
   */
  balanceAtDate(accountId, initialBalanceCents, date) {
    const sum = (sql) => this.db.prepare(sql).get(accountId, date).c || 0;
    const income = sum(`SELECT SUM(amount_cents) c FROM transactions WHERE account_id = ? AND type = 'income' AND status = 'confirmed' AND date <= ?`);
    const expense = sum(`SELECT SUM(amount_cents) c FROM transactions WHERE account_id = ? AND type = 'expense' AND status = 'confirmed' AND date <= ?`);
    const outTransfers = sum(`SELECT SUM(amount_cents) c FROM transactions WHERE account_id = ? AND type = 'transfer' AND status = 'confirmed' AND date <= ?`);
    const inTransfers = sum(`SELECT SUM(amount_cents) c FROM transactions WHERE to_account_id = ? AND type = 'transfer' AND status = 'confirmed' AND date <= ?`);
    return initialBalanceCents + income - expense - outTransfers + inTransfers;
  }

  /**
   * Finds a suitable income leaf category for interest income.
   * Prefers 'Rendimentos de Investimentos'; falls back to any active income
   * leaf; null is allowed (transaction stays uncategorized).
   * @private
   */
  findInterestCategoryId() {
    const preferred = this.db
      .prepare(
        `SELECT c.id FROM categories c
         WHERE c.name = 'Rendimentos de Investimentos' AND c.kind = 'income' AND c.archived = 0
           AND NOT EXISTS (SELECT 1 FROM categories ch WHERE ch.parent_id = c.id AND ch.archived = 0)
         LIMIT 1`
      )
      .get();
    if (preferred) return preferred.id;

    const anyIncomeLeaf = this.db
      .prepare(
        `SELECT c.id FROM categories c
         WHERE c.kind = 'income' AND c.archived = 0
           AND NOT EXISTS (SELECT 1 FROM categories ch WHERE ch.parent_id = c.id AND ch.archived = 0)
         ORDER BY c.id LIMIT 1`
      )
      .get();
    return anyIncomeLeaf ? anyIncomeLeaf.id : null;
  }
}

export const interestService = new InterestService();
