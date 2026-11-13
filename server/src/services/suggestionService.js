import { getDb } from '../db.js';

export class SuggestionService {
  /**
   * @param {import('better-sqlite3').Database} [db]
   */
  constructor(db) {
    this.db = db || getDb();
  }

  /**
   * Returns ranked transaction name suggestions for a given category.
   * Ranks by uses DESC, last_used DESC, name ASC.
   * Merges active recurring items (cold start) with uses = 0.
   * Returns `last_amount_cents` for each suggestion.
   *
   * @param {number} categoryId
   * @param {string} [prefix='']
   * @returns {Array<{ name: string, uses: number, last_used: string, last_amount_cents: number }>}
   */
  getNameSuggestions(categoryId, prefix = '') {
    // Sanitize search prefix for SQL LIKE pattern
    const sanitizedPrefix = prefix.replace(/([%_\\])/g, '\\$1');

    const sql = `
      WITH RankedTransactions AS (
        SELECT
          name,
          amount_cents,
          date,
          ROW_NUMBER() OVER (
            PARTITION BY name COLLATE NOCASE
            ORDER BY date DESC, id DESC
          ) AS rn,
          COUNT(*) OVER (
            PARTITION BY name COLLATE NOCASE
          ) AS uses,
          MAX(date) OVER (
            PARTITION BY name COLLATE NOCASE
          ) AS last_used
        FROM transactions
        WHERE category_id = :categoryId
          AND name IS NOT NULL AND TRIM(name) <> ''
          AND name LIKE :prefix || '%' ESCAPE '\\' COLLATE NOCASE
      ),
      HistoricalSuggestions AS (
        SELECT
          name,
          uses,
          last_used,
          amount_cents AS last_amount_cents
        FROM RankedTransactions
        WHERE rn = 1
      ),
      RecurringSuggestions AS (
        SELECT
          name,
          0 AS uses,
          start_date AS last_used,
          amount_cents AS last_amount_cents
        FROM recurring_items
        WHERE category_id = :categoryId
          AND active = 1
          AND name LIKE :prefix || '%' ESCAPE '\\' COLLATE NOCASE
          AND name COLLATE NOCASE NOT IN (SELECT name FROM HistoricalSuggestions)
      )
      SELECT name, uses, last_used, last_amount_cents
      FROM (
        SELECT * FROM HistoricalSuggestions
        UNION ALL
        SELECT * FROM RecurringSuggestions
      )
      ORDER BY uses DESC, last_used DESC, name COLLATE NOCASE ASC
      LIMIT 10;
    `;

    return this.db.prepare(sql).all({
      categoryId,
      prefix: sanitizedPrefix
    });
  }
}

export const suggestionService = new SuggestionService();
