import { getDb } from '../db.js';
import { AccountService } from './accountService.js';
import { CategoryService } from './categoryService.js';

export class TransactionService {
  /**
   * @param {import('better-sqlite3').Database} [db]
   */
  constructor(db) {
    this.db = db || getDb();
    this.accountService = new AccountService(this.db);
    this.categoryService = new CategoryService(this.db);
  }

  /**
   * Normalizes a transaction name and reuses the most common casing if already present in the category.
   * @param {string | null} rawName
   * @param {number | null} categoryId
   * @returns {string | null}
   */
  normalizeName(rawName, categoryId) {
    if (!rawName) return null;
    const cleaned = rawName.trim().replace(/\s+/g, ' ');
    if (!cleaned) return null;

    if (!categoryId) return cleaned;

    // Look for existing case-insensitive match in the same category
    const existingSpelling = this.db
      .prepare(`
        SELECT name, COUNT(*) as count
        FROM transactions
        WHERE category_id = ?
          AND name LIKE ? COLLATE NOCASE
        GROUP BY name
        ORDER BY count DESC
        LIMIT 1
      `)
      .get(categoryId, cleaned);

    if (existingSpelling && existingSpelling.name.toLowerCase() === cleaned.toLowerCase()) {
      return existingSpelling.name;
    }

    return cleaned;
  }

  /**
   * Lists transactions with optional filters and pagination.
   */
  listTransactions({
    from,
    to,
    account_id,
    category_id,
    type,
    status,
    q,
    page = 1,
    limit = 50
  } = {}) {
    const whereConditions = [];
    const params = [];

    if (from) {
      whereConditions.push('t.date >= ?');
      params.push(from);
    }
    if (to) {
      whereConditions.push('t.date <= ?');
      params.push(to);
    }
    if (account_id) {
      whereConditions.push('(t.account_id = ? OR t.to_account_id = ?)');
      params.push(account_id, account_id);
    }
    if (category_id) {
      whereConditions.push('t.category_id = ?');
      params.push(category_id);
    }
    if (type) {
      whereConditions.push('t.type = ?');
      params.push(type);
    }
    if (status) {
      whereConditions.push('t.status = ?');
      params.push(status);
    }
    if (q) {
      whereConditions.push('(t.name LIKE ? OR t.notes LIKE ?)');
      const term = `%${q}%`;
      params.push(term, term);
    }

    const whereClause = whereConditions.length > 0 ? `WHERE ${whereConditions.join(' AND ')}` : '';

    // Count total rows matching filters
    const countSql = `
      SELECT COUNT(*) as total
      FROM transactions t
      ${whereClause}
    `;
    const totalRow = this.db.prepare(countSql).get(...params);
    const total = totalRow ? totalRow.total : 0;
    const totalPages = Math.ceil(total / limit) || 1;
    const offset = (page - 1) * limit;

    // Retrieve paginated records with account and category details
    const selectSql = `
      SELECT
        t.*,
        a.name AS account_name,
        a.type AS account_type,
        toa.name AS to_account_name,
        toa.type AS to_account_type,
        c.name AS category_name,
        c.kind AS category_kind,
        c.budget_group AS category_budget_group,
        p.name AS parent_category_name
      FROM transactions t
      JOIN accounts a ON t.account_id = a.id
      LEFT JOIN accounts toa ON t.to_account_id = toa.id
      LEFT JOIN categories c ON t.category_id = c.id
      LEFT JOIN categories p ON c.parent_id = p.id
      ${whereClause}
      ORDER BY t.date DESC, t.id DESC
      LIMIT ? OFFSET ?
    `;

    const data = this.db.prepare(selectSql).all(...params, limit, offset);

    return {
      data,
      pagination: {
        page,
        limit,
        total,
        totalPages
      }
    };
  }

  /**
   * Retrieves a single transaction by ID with joined metadata.
   */
  getTransactionById(id) {
    const sql = `
      SELECT
        t.*,
        a.name AS account_name,
        a.type AS account_type,
        toa.name AS to_account_name,
        toa.type AS to_account_type,
        c.name AS category_name,
        c.kind AS category_kind,
        c.budget_group AS category_budget_group,
        p.name AS parent_category_name
      FROM transactions t
      JOIN accounts a ON t.account_id = a.id
      LEFT JOIN accounts toa ON t.to_account_id = toa.id
      LEFT JOIN categories c ON t.category_id = c.id
      LEFT JOIN categories p ON c.parent_id = p.id
      WHERE t.id = ?
    `;
    return this.db.prepare(sql).get(id) || null;
  }

  /**
   * Creates a transaction validating leaf categories and transfer rules.
   */
  createTransaction({
    date,
    type,
    amount_cents,
    account_id,
    to_account_id = null,
    category_id = null,
    name = null,
    notes = null,
    status = 'confirmed',
    recurring_id = null,
    import_hash = null
  }) {
    // 1. Validate primary account
    const account = this.accountService.getAccountById(account_id);
    if (!account) {
      const error = new Error('A conta indicada não existe');
      error.code = 'INVALID_ACCOUNT';
      error.status = 400;
      throw error;
    }

    // 2. Validate transfer rules
    if (type === 'transfer') {
      if (!to_account_id) {
        const error = new Error('Transferências requerem uma conta de destino');
        error.code = 'INVALID_TRANSFER';
        error.status = 400;
        throw error;
      }
      if (to_account_id === account_id) {
        const error = new Error('A conta de destino não pode ser igual à de origem');
        error.code = 'INVALID_TRANSFER';
        error.status = 400;
        throw error;
      }
      const toAccount = this.accountService.getAccountById(to_account_id);
      if (!toAccount) {
        const error = new Error('A conta de destino não existe');
        error.code = 'INVALID_ACCOUNT';
        error.status = 400;
        throw error;
      }
      category_id = null;
    } else {
      // 3. Validate category & leaf rule for income/expense
      if (!category_id) {
        const error = new Error('A categoria é obrigatória para despesas e receitas');
        error.code = 'CATEGORY_REQUIRED';
        error.status = 400;
        throw error;
      }

      const isLeaf = this.categoryService.isLeafCategory(category_id);
      if (!isLeaf) {
        const error = new Error(
          'Só é permitido associar transações a categorias folha (categorias sem subcategorias)'
        );
        error.code = 'NON_LEAF_CATEGORY';
        error.status = 400;
        throw error;
      }

      to_account_id = null;
    }

    // Normalize name
    const normalizedName = this.normalizeName(name, category_id);

    const stmt = this.db.prepare(`
      INSERT INTO transactions (
        date, type, amount_cents, account_id, to_account_id,
        category_id, name, notes, status, recurring_id, import_hash
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const result = stmt.run(
      date,
      type,
      amount_cents,
      account_id,
      to_account_id,
      category_id,
      normalizedName,
      notes ? notes.trim() : null,
      status,
      recurring_id,
      import_hash
    );

    return this.getTransactionById(result.lastInsertRowid);
  }

  /**
   * Updates an existing transaction.
   */
  updateTransaction(id, updates) {
    const existing = this.getTransactionById(id);
    if (!existing) {
      return null;
    }

    const merged = { ...existing, ...updates };

    // Validate account if changed
    if (updates.account_id !== undefined) {
      const acc = this.accountService.getAccountById(updates.account_id);
      if (!acc) {
        const error = new Error('A conta indicada não existe');
        error.code = 'INVALID_ACCOUNT';
        error.status = 400;
        throw error;
      }
    }

    // Validate type / transfers
    if (merged.type === 'transfer') {
      if (!merged.to_account_id) {
        const error = new Error('Transferências requerem uma conta de destino');
        error.code = 'INVALID_TRANSFER';
        error.status = 400;
        throw error;
      }
      if (merged.to_account_id === merged.account_id) {
        const error = new Error('A conta de destino não pode ser igual à de origem');
        error.code = 'INVALID_TRANSFER';
        error.status = 400;
        throw error;
      }
      const toAcc = this.accountService.getAccountById(merged.to_account_id);
      if (!toAcc) {
        const error = new Error('A conta de destino não existe');
        error.code = 'INVALID_ACCOUNT';
        error.status = 400;
        throw error;
      }
      merged.category_id = null;
    } else {
      if (!merged.category_id) {
        const error = new Error('A categoria é obrigatória');
        error.code = 'CATEGORY_REQUIRED';
        error.status = 400;
        throw error;
      }
      if (!this.categoryService.isLeafCategory(merged.category_id)) {
        const error = new Error('Só é permitido associar transações a categorias folha');
        error.code = 'NON_LEAF_CATEGORY';
        error.status = 400;
        throw error;
      }
      merged.to_account_id = null;
    }

    const normalizedName = updates.name !== undefined
      ? this.normalizeName(updates.name, merged.category_id)
      : existing.name;

    const fields = [
      'date = ?',
      'type = ?',
      'amount_cents = ?',
      'account_id = ?',
      'to_account_id = ?',
      'category_id = ?',
      'name = ?',
      'notes = ?',
      'status = ?'
    ];
    const values = [
      merged.date,
      merged.type,
      merged.amount_cents,
      merged.account_id,
      merged.to_account_id,
      merged.category_id,
      normalizedName,
      merged.notes ? String(merged.notes).trim() : null,
      merged.status,
      id
    ];

    this.db.prepare(`UPDATE transactions SET ${fields.join(', ')} WHERE id = ?`).run(...values);

    return this.getTransactionById(id);
  }

  /**
   * Deletes a transaction by ID.
   * If it was a recurring-generated planned transaction, records in skipped_occurrences.
   */
  deleteTransaction(id) {
    const existing = this.getTransactionById(id);
    if (!existing) {
      return false;
    }

    const runDelete = this.db.transaction(() => {
      if (existing.recurring_id && existing.status === 'planned') {
        this.db.prepare(`
          INSERT INTO skipped_occurrences (recurring_id, date)
          VALUES (?, ?)
          ON CONFLICT(recurring_id, date) DO NOTHING
        `).run(existing.recurring_id, existing.date);
      }

      this.db.prepare('DELETE FROM transactions WHERE id = ?').run(id);
    });

    runDelete();
    return true;
  }
}

export const transactionService = new TransactionService();
