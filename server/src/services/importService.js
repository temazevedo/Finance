import { createHash } from 'node:crypto';
import { getDb } from '../db.js';
import { parseStatement } from './importParser.js';
import { normalizeText } from '../utils/normalize.js';

/**
 * V2 bank statement import (AGENT.md section 14).
 *
 * Flow: parse file -> stage rows in import_batches/import_rows (draft) with
 * dedupe + deterministic category matching + planned-transaction proposals ->
 * user fixes/excludes rows in the review screen -> atomic commit into
 * transactions. Nothing touches `transactions` before commit.
 */
export class ImportService {
  constructor(db) {
    this.db = db || getDb();
  }

  // ---------------------------------------------------------------- profiles

  listProfiles() {
    return this.db
      .prepare('SELECT id, name, config_json, created_by, created_at FROM import_profiles ORDER BY name ASC')
      .all()
      .map((r) => ({ ...r, config: JSON.parse(r.config_json) }));
  }

  getProfileById(id) {
    const row = this.db
      .prepare('SELECT id, name, config_json, created_by, created_at FROM import_profiles WHERE id = ?')
      .get(id);
    if (!row) return null;
    return { ...row, config: JSON.parse(row.config_json) };
  }

  createProfile({ name, config, created_by = 'manual' }) {
    const result = this.db
      .prepare('INSERT INTO import_profiles (name, config_json, created_by) VALUES (?, ?, ?)')
      .run(name, JSON.stringify(config), created_by);
    return this.getProfileById(result.lastInsertRowid);
  }

  updateProfile(id, { name, config }) {
    const existing = this.getProfileById(id);
    if (!existing) return null;
    const nextName = name !== undefined ? name : existing.name;
    const nextConfig = config !== undefined ? config : existing.config;
    this.db
      .prepare('UPDATE import_profiles SET name = ?, config_json = ? WHERE id = ?')
      .run(nextName, JSON.stringify(nextConfig), id);
    return this.getProfileById(id);
  }

  // ---------------------------------------------------------------- batches

  /**
   * Creates a draft import batch from an uploaded CSV file.
   * @param {number} accountId
   * @param {string} filename
   * @param {{ profileId?: number, config?: object, profileName?: string }} profileRef
   * @param {Buffer} fileBuffer
   */
  createBatch(accountId, filename, { profileId, config, profileName }, fileBuffer) {
    const account = this.db
      .prepare('SELECT id, name FROM accounts WHERE id = ? AND archived = 0')
      .get(accountId);
    if (!account) {
      const error = new Error('Conta não encontrada');
      error.code = 'NOT_FOUND';
      error.status = 404;
      throw error;
    }

    // Resolve profile: saved profile wins; otherwise use the inline config
    let profile = null;
    if (profileId) {
      profile = this.getProfileById(profileId);
      if (!profile) {
        const error = new Error('Perfil de importação não encontrado');
        error.code = 'NOT_FOUND';
        error.status = 404;
        throw error;
      }
      config = profile.config;
    }
    if (!config) {
      const error = new Error('É necessário escolher um perfil de importação ou fornecer uma configuração');
      error.code = 'PROFILE_REQUIRED';
      error.status = 400;
      throw error;
    }

    const { rows, errors } = parseStatement(fileBuffer, config);
    if (rows.length === 0) {
      const error = new Error(
        errors.length > 0
          ? `Nenhuma linha válida encontrada (${errors.length} linha(s) com erros)`
          : 'Nenhuma linha válida encontrada no ficheiro'
      );
      error.code = 'NO_VALID_ROWS';
      error.status = 400;
      error.details = errors;
      throw error;
    }

    // Existing name -> category knowledge from confirmed transactions (14.3)
    const knowledge = this.buildNameKnowledge();
    // Existing hashes for duplicate detection (14.4)
    const existingHashes = new Set(
      this.db.prepare('SELECT import_hash FROM transactions WHERE import_hash IS NOT NULL').all().map((r) => r.import_hash)
    );
    // Safety net for data without import_hash (legacy/manual imports): count
    // confirmed rows per (date, amount, normalized description) on the account.
    const existingKeyCounts = new Map();
    for (const tx of this.db
      .prepare(`SELECT date, amount_cents, name FROM transactions WHERE account_id = ? AND status = 'confirmed' AND name IS NOT NULL AND name != ''`)
      .all(accountId)) {
      const key = `${tx.date}|${tx.amount_cents}|${normalizeText(tx.name)}`;
      existingKeyCounts.set(key, (existingKeyCounts.get(key) || 0) + 1);
    }
    // Existing planned transactions on this account for reconciliation proposals
    const plannedTxs = this.db
      .prepare(`SELECT id, date, amount_cents, category_id, name FROM transactions WHERE account_id = ? AND status = 'planned'`)
      .all(accountId);

    const staged = this.stageRows(accountId, rows, { knowledge, existingHashes, existingKeyCounts, plannedTxs });

    const insertBatch = this.db.transaction(() => {
      const batchResult = this.db
        .prepare('INSERT INTO import_batches (account_id, profile_id, filename, status) VALUES (?, ?, ?, ?)')
        .run(accountId, profile ? profileId : null, filename, 'draft');
      const batchId = batchResult.lastInsertRowid;

      const insertRow = this.db.prepare(
        `INSERT INTO import_rows (
           batch_id, row_number, date, amount_cents, type, description, name,
           category_id, match_status, planned_transaction_id, import_hash, raw_json
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      );
      staged.forEach((r, index) => {
        insertRow.run(
          batchId,
          index + 1,
          r.date,
          r.amount_cents,
          r.type,
          r.description,
          r.name,
          r.category_id,
          r.match_status,
          r.planned_transaction_id,
          r.import_hash,
          JSON.stringify(r.raw)
        );
      });

      return batchId;
    });

    const batchId = insertBatch();
    return this.getBatch(batchId, { parse_errors: errors });
  }

  /**
   * Computes hash, match status, category and planned proposal for each row.
   * @private
   */
  stageRows(accountId, rows, { knowledge, existingHashes, existingKeyCounts, plannedTxs }) {
    // occurrence_index: distinguishes identical rows (same day/amount/description) in the file
    const occurrence = new Map();

    return rows.map((row) => {
      const key = `${row.date}|${row.amount_cents}|${row.normalized}`;
      const occurrenceIndex = occurrence.get(key) ?? 0;
      occurrence.set(key, occurrenceIndex + 1);

      const importHash = createHash('sha256')
        .update(`${accountId}|${row.date}|${row.amount_cents}|${row.normalized}|${occurrenceIndex}`)
        .digest('hex');

      // Duplicates are skipped by default (14.4). The hash catches rows
      // imported through this system before; the key-count check also catches
      // legacy/manual data without import_hash.
      const isDuplicate =
        existingHashes.has(importHash) ||
        (existingKeyCounts.get(key) || 0) > occurrenceIndex;
      if (isDuplicate) {
        return { ...row, import_hash: importHash, match_status: 'duplicate', name: row.description, category_id: null, planned_transaction_id: null };
      }

      // Deterministic exact-name matching (14.3)
      const knowledgeEntry = knowledge.get(row.normalized);
      let name = row.description;
      let categoryId = null;
      let matchStatus = 'needs_category';

      if (knowledgeEntry) {
        name = knowledgeEntry.topSpelling;
        categoryId = knowledgeEntry.topCategory.id;
        matchStatus = knowledgeEntry.distinctCategories.length > 1 ? 'ambiguous' : 'matched';
      }

      // Planned-transaction reconciliation proposal (14.4) — never automatic
      const candidate = this.findPlannedCandidate(plannedTxs, row, categoryId);
      const plannedTransactionId = candidate ? candidate.id : null;

      return {
        ...row,
        import_hash: importHash,
        match_status: matchStatus,
        name,
        category_id: categoryId,
        planned_transaction_id: plannedTransactionId
      };
    });
  }

  /**
   * Maps normalized name -> { topSpelling, topCategory, distinctCategories }.
   * @private
   */
  buildNameKnowledge() {
    const rows = this.db
      .prepare(
        `SELECT name, category_id, COUNT(*) AS uses
         FROM transactions
         WHERE status = 'confirmed' AND name IS NOT NULL AND name != ''
         GROUP BY name, category_id`
      )
      .all();

    const map = new Map();
    for (const { name, category_id, uses } of rows) {
      const key = normalizeText(name);
      if (!key) continue;
      let entry = map.get(key);
      if (!entry) {
        entry = { spellings: new Map(), categories: new Map() };
        map.set(key, entry);
      }
      entry.spellings.set(name, (entry.spellings.get(name) || 0) + uses);
      if (category_id !== null) {
        entry.categories.set(category_id, (entry.categories.get(category_id) || 0) + uses);
      }
    }

    // Resolve most-used spelling and most-used category
    for (const [key, entry] of map) {
      const spellings = [...entry.spellings.entries()].sort((a, b) => b[1] - a[1]);
      const categories = [...entry.categories.entries()].sort((a, b) => b[1] - a[1]);
      map.set(key, {
        topSpelling: spellings[0][0],
        topCategory: { id: categories.length > 0 ? categories[0][0] : null, uses: categories.length > 0 ? categories[0][1] : 0 },
        distinctCategories: categories
      });
    }
    return map;
  }

  /**
   * Finds a planned transaction that looks like this imported row.
   * Same account + amount, date within ±5 days, same category or same
   * normalized name (when known).
   * @private
   */
  findPlannedCandidate(plannedTxs, row, categoryId) {
    const rowDate = row.date;
    for (const tx of plannedTxs) {
      if (tx.amount_cents !== row.amount_cents) continue;
      const diff = Math.abs(this.dateDiffDays(rowDate, tx.date));
      if (diff > 5) continue;
      const sameCategory = categoryId !== null && tx.category_id === categoryId;
      const sameName = tx.name ? normalizeText(tx.name) === row.normalized : false;
      if (sameCategory || sameName) {
        return tx;
      }
    }
    return null;
  }

  /**
   * Day difference between two YYYY-MM-DD strings (a - b) using UTC noon to
   * avoid DST edge cases.
   * @private
   */
  dateDiffDays(a, b) {
    const toUTC = (s) => {
      const [y, m, d] = s.split('-').map(Number);
      return Date.UTC(y, m - 1, d);
    };
    return Math.round((toUTC(a) - toUTC(b)) / 86400000);
  }

  /**
   * Batch with rows and counts per match_status.
   */
  getBatch(id, extra = {}) {
    const batch = this.db
      .prepare(
        `SELECT b.*, a.name AS account_name, p.name AS profile_name
         FROM import_batches b
         JOIN accounts a ON a.id = b.account_id
         LEFT JOIN import_profiles p ON p.id = b.profile_id
         WHERE b.id = ?`
      )
      .get(id);
    if (!batch) return null;

    const rows = this.db
      .prepare(
        `SELECT r.*, c.name AS category_name
         FROM import_rows r
         LEFT JOIN categories c ON c.id = r.category_id
         WHERE r.batch_id = ?
         ORDER BY r.row_number ASC`
      )
      .all(id);

    const counts = { matched: 0, ambiguous: 0, needs_category: 0, duplicate: 0 };
    for (const r of rows) {
      if (counts[r.match_status] !== undefined) counts[r.match_status]++;
    }

    return { ...batch, rows, counts, ...extra };
  }

  /**
   * Updates a staged row of a draft batch (category/name/exclude/planned/transfer).
   */
  updateRow(batchId, rowId, patch) {
    const batch = this.db.prepare('SELECT * FROM import_batches WHERE id = ?').get(batchId);
    if (!batch) {
      const error = new Error('Importação não encontrada');
      error.code = 'NOT_FOUND';
      error.status = 404;
      throw error;
    }
    if (batch.status !== 'draft') {
      const error = new Error('A importação já foi fechada e não pode ser alterada');
      error.code = 'BATCH_CLOSED';
      error.status = 409;
      throw error;
    }

    const row = this.db
      .prepare('SELECT * FROM import_rows WHERE id = ? AND batch_id = ?')
      .get(rowId, batchId);
    if (!row) {
      const error = new Error('Linha de importação não encontrada');
      error.code = 'NOT_FOUND';
      error.status = 404;
      throw error;
    }

    if (patch.excluded !== undefined) {
      this.db.prepare('UPDATE import_rows SET excluded = ? WHERE id = ?').run(patch.excluded ? 1 : 0, rowId);
    }
    if (patch.name !== undefined) {
      this.db.prepare('UPDATE import_rows SET name = ? WHERE id = ?').run(patch.name, rowId);
    }
    if (patch.category_id !== undefined) {
      if (patch.category_id !== null) {
        const category = this.db
          .prepare('SELECT id, kind FROM categories WHERE id = ? AND archived = 0')
          .get(patch.category_id);
        if (!category) {
          const error = new Error('Categoria não encontrada');
          error.code = 'NOT_FOUND';
          error.status = 404;
          throw error;
        }
        if (row.type !== 'transfer' && category.kind !== row.type) {
          const error = new Error(`A categoria deve ser do tipo ${row.type === 'expense' ? 'despesa' : 'receita'}`);
          error.code = 'KIND_MISMATCH';
          error.status = 400;
          throw error;
        }
      }
      this.db.prepare('UPDATE import_rows SET category_id = ? WHERE id = ?').run(patch.category_id, rowId);
      // A manual category resolves ambiguity
      if (row.match_status === 'ambiguous') {
        this.db.prepare(`UPDATE import_rows SET match_status = 'matched' WHERE id = ?`).run(rowId);
      }
    }
    if (patch.accept_planned !== undefined) {
      if (patch.accept_planned && row.planned_transaction_id === null) {
        const error = new Error('Esta linha não tem um movimento planeado proposto');
        error.code = 'NO_PLANNED_MATCH';
        error.status = 400;
        throw error;
      }
      this.db
        .prepare('UPDATE import_rows SET planned_accepted = ? WHERE id = ?')
        .run(patch.accept_planned ? 1 : 0, rowId);
    }
    if (patch.type === 'transfer') {
      const toAccount = this.db
        .prepare('SELECT id FROM accounts WHERE id = ? AND archived = 0')
        .get(patch.to_account_id);
      if (!toAccount) {
        const error = new Error('Conta de destino não encontrada');
        error.code = 'NOT_FOUND';
        error.status = 404;
        throw error;
      }
      if (toAccount.id === batch.account_id) {
        const error = new Error('A conta de destino deve ser diferente da conta da importação');
        error.code = 'INVALID_TRANSFER';
        error.status = 400;
        throw error;
      }
      this.db
        .prepare(`UPDATE import_rows SET type = 'transfer', to_account_id = ?, category_id = NULL, planned_transaction_id = NULL, planned_accepted = 0 WHERE id = ?`)
        .run(patch.to_account_id, rowId);
    }

    return this.getBatch(batchId);
  }

  /**
   * Commits the batch atomically: creates transactions (and confirms
   * user-accepted planned reconciliations). Blocks while any non-excluded,
   * non-duplicate row is unresolved.
   */
  commitBatch(batchId) {
    const batch = this.db.prepare('SELECT * FROM import_batches WHERE id = ?').get(batchId);
    if (!batch) {
      const error = new Error('Importação não encontrada');
      error.code = 'NOT_FOUND';
      error.status = 404;
      throw error;
    }
    if (batch.status !== 'draft') {
      const error = new Error('A importação já foi fechada');
      error.code = 'BATCH_CLOSED';
      error.status = 409;
      throw error;
    }

    const rows = this.db
      .prepare(`SELECT * FROM import_rows WHERE batch_id = ? AND excluded = 0 AND match_status != 'duplicate' ORDER BY row_number ASC`)
      .all(batchId);

    const unresolved = rows.filter((r) => {
      if (r.type === 'transfer') return r.to_account_id === null;
      if (r.planned_accepted) return false; // confirmed planned tx carries its own category
      return r.category_id === null;
    });
    if (unresolved.length > 0) {
      const error = new Error(
        `${unresolved.length} linha(s) sem categoria (ou sem conta de destino, nas transferências). Resolva todas as linhas antes de confirmar.`
      );
      error.code = 'UNRESOLVED_ROWS';
      error.status = 400;
      error.details = unresolved.map((r) => ({ row_id: r.id, row_number: r.row_number, description: r.description }));
      throw error;
    }

    const getPlanned = this.db.prepare(`SELECT id, status FROM transactions WHERE id = ?`);
    const confirmPlanned = this.db.prepare(
      `UPDATE transactions SET status = 'confirmed', date = ?, amount_cents = ?, import_hash = ? WHERE id = ?`
    );
    const insertTx = this.db.prepare(
      `INSERT INTO transactions (date, type, amount_cents, account_id, to_account_id, category_id, name, status, import_hash)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'confirmed', ?)`
    );

    const run = this.db.transaction(() => {
      let created = 0;
      let reconciled = 0;

      for (const row of rows) {
        if (row.planned_accepted && row.planned_transaction_id) {
          const planned = getPlanned.get(row.planned_transaction_id);
          if (!planned || planned.status !== 'planned') {
            const error = new Error(
              `O movimento planeado da linha ${row.row_number} já não está disponível. Atualize a linha e confirme novamente.`
            );
            error.code = 'PLANNED_GONE';
            throw error;
          }
          confirmPlanned.run(row.date, row.amount_cents, row.import_hash, row.planned_transaction_id);
          reconciled++;
        } else {
          insertTx.run(
            row.date,
            row.type,
            row.amount_cents,
            batch.account_id,
            row.type === 'transfer' ? row.to_account_id : null,
            row.type === 'transfer' ? null : row.category_id,
            row.name || row.description,
            row.import_hash
          );
          created++;
        }
      }

      this.db.prepare(`UPDATE import_batches SET status = 'committed' WHERE id = ?`).run(batchId);
      return { created, reconciled };
    });

    const result = run();
    return { batch_id: batchId, status: 'committed', ...result };
  }

  /**
   * Discards a draft batch.
   */
  discardBatch(batchId) {
    const batch = this.db.prepare('SELECT * FROM import_batches WHERE id = ?').get(batchId);
    if (!batch) {
      const error = new Error('Importação não encontrada');
      error.code = 'NOT_FOUND';
      error.status = 404;
      throw error;
    }
    if (batch.status !== 'draft') {
      const error = new Error('A importação já foi fechada');
      error.code = 'BATCH_CLOSED';
      error.status = 409;
      throw error;
    }
    this.db.prepare(`UPDATE import_batches SET status = 'discarded' WHERE id = ?`).run(batchId);
    this.db.prepare('DELETE FROM import_rows WHERE batch_id = ?').run(batchId);
    return { id: batchId, status: 'discarded' };
  }
}

export const importService = new ImportService();
