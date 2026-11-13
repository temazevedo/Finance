import { getDb } from '../db.js';

/**
 * Builds a full transactions CSV export (";" separator, decimal comma,
 * UTF-8 BOM for Excel compatibility).
 * @param {import('better-sqlite3').Database} [db]
 * @returns {string}
 */
export function generateTransactionsCsv(db = getDb()) {
  const rows = db
    .prepare(`
      SELECT
        t.id, t.date, t.type, t.amount_cents, t.name, t.notes, t.status,
        c.name AS category_name, p.name AS parent_category_name,
        a.name AS account_name, toa.name AS to_account_name
      FROM transactions t
      LEFT JOIN categories c ON c.id = t.category_id
      LEFT JOIN categories p ON p.id = c.parent_id
      JOIN accounts a ON a.id = t.account_id
      LEFT JOIN accounts toa ON toa.id = t.to_account_id
      ORDER BY t.date ASC, t.id ASC
    `)
    .all();

  const header = [
    'id',
    'data',
    'tipo',
    'designacao',
    'categoria',
    'conta',
    'conta_destino',
    'montante_eur',
    'montante_cents',
    'estado',
    'notas'
  ];

  const lines = [header.map(csvEscape).join(';')];
  for (const row of rows) {
    lines.push(
      [
        row.id,
        row.date,
        row.type,
        row.name,
        buildCategoryName(row),
        row.account_name,
        row.to_account_name,
        centsToDecimalString(row.amount_cents),
        row.amount_cents,
        row.status,
        row.notes
      ]
        .map(csvEscape)
        .join(';')
    );
  }

  return '\uFEFF' + lines.join('\r\n') + '\r\n';
}

function buildCategoryName(row) {
  if (row.type === 'transfer') return 'Transferência';
  if (row.parent_category_name && row.category_name) {
    return `${row.parent_category_name} → ${row.category_name}`;
  }
  return row.category_name || '';
}

function centsToDecimalString(cents) {
  return (cents / 100).toFixed(2).replace('.', ',');
}

function csvEscape(value) {
  if (value === null || value === undefined) return '';
  const str = String(value);
  if (/[";\r\n]/.test(str)) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}
