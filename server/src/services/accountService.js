import { getDb } from '../db.js';

export class AccountService {
  /**
   * @param {import('better-sqlite3').Database} [db]
   */
  constructor(db) {
    this.db = db || getDb();
  }

  /**
   * Lists all accounts, optionally filtering archived ones.
   */
  listAccounts({ includeArchived = false } = {}) {
    let query = 'SELECT * FROM accounts';
    const params = [];

    if (!includeArchived) {
      query += ' WHERE archived = 0';
    }
    query += ' ORDER BY name ASC';

    return this.db.prepare(query).all(...params);
  }

  /**
   * Gets a single account by ID.
   */
  getAccountById(id) {
    return this.db.prepare('SELECT * FROM accounts WHERE id = ?').get(id);
  }

  /**
   * Creates a new account.
   */
  createAccount({ name, type, initial_balance_cents = 0 }) {
    const stmt = this.db.prepare(`
      INSERT INTO accounts (name, type, initial_balance_cents)
      VALUES (?, ?, ?)
    `);
    const result = stmt.run(name, type, initial_balance_cents);
    return this.getAccountById(result.lastInsertRowid);
  }

  /**
   * Updates an existing account.
   */
  updateAccount(id, updates) {
    const existing = this.getAccountById(id);
    if (!existing) {
      return null;
    }

    const fields = [];
    const values = [];

    if (updates.name !== undefined) {
      fields.push('name = ?');
      values.push(updates.name);
    }
    if (updates.type !== undefined) {
      fields.push('type = ?');
      values.push(updates.type);
    }
    if (updates.initial_balance_cents !== undefined) {
      fields.push('initial_balance_cents = ?');
      values.push(updates.initial_balance_cents);
    }
    if (updates.archived !== undefined) {
      fields.push('archived = ?');
      values.push(updates.archived);
    }

    if (fields.length === 0) {
      return existing;
    }

    values.push(id);
    const sql = `UPDATE accounts SET ${fields.join(', ')} WHERE id = ?`;
    this.db.prepare(sql).run(...values);

    return this.getAccountById(id);
  }

  /**
   * Computes the current balance per account (confirmed transactions only).
   * Formula: initial_balance_cents + confirmed income - confirmed expenses - outgoing transfers + incoming transfers.
   */
  getAccountBalances({ includeArchived = false } = {}) {
    let whereClause = '';
    if (!includeArchived) {
      whereClause = 'WHERE a.archived = 0';
    }

    const sql = `
      SELECT
        a.id,
        a.name,
        a.type,
        a.initial_balance_cents,
        a.archived,
        a.created_at,
        (
          a.initial_balance_cents
          + COALESCE((SELECT SUM(amount_cents) FROM transactions WHERE account_id = a.id AND type = 'income' AND status = 'confirmed'), 0)
          - COALESCE((SELECT SUM(amount_cents) FROM transactions WHERE account_id = a.id AND type = 'expense' AND status = 'confirmed'), 0)
          - COALESCE((SELECT SUM(amount_cents) FROM transactions WHERE account_id = a.id AND type = 'transfer' AND status = 'confirmed'), 0)
          + COALESCE((SELECT SUM(amount_cents) FROM transactions WHERE to_account_id = a.id AND type = 'transfer' AND status = 'confirmed'), 0)
        ) AS balance_cents
      FROM accounts a
      ${whereClause}
      ORDER BY a.name ASC
    `;

    return this.db.prepare(sql).all();
  }
}

export const accountService = new AccountService();
