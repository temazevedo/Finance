import fs from 'node:fs';
import path from 'node:path';
import { getDb } from '../../server/src/db.js';

/**
 * Imports CGD bank statement history (staged by scripts/import/cgd_csv_to_staged.py)
 * into the existing "CGD à Ordem" account WITHOUT duplicating the movements that
 * were already imported from the ODS ledger (2026-10-01 onwards).
 *
 * Usage:
 *   node scripts/import/import_cgd_history.js imports/staged_cgd.json [--dry-run]
 *
 * Behaviour:
 * - Only rows BEFORE the staged cutoff (2026-10-01) are candidates.
 * - Aborts if the account already has any transaction before the cutoff
 *   (history would be duplicated); idempotent re-runs are detected this way.
 * - Lowering the account initial balance to the staged opening balance keeps
 *   every historical running balance correct.
 * - Creates the "Transportes" root category (user decision) if missing;
 *   every other category must already exist.
 * - Dedupe by multiset of (date, amount_cents, name) against existing rows.
 * - Reconciles the final balance after insert.
 */

const ACCOUNT_NAME = 'CGD à Ordem';
const NEW_CATEGORY = 'Transportes';

const stagedPath = process.argv[2];
const isDryRun = process.argv.includes('--dry-run');

if (!stagedPath) {
  console.error('Usage: node scripts/import/import_cgd_history.js <staged_cgd.json> [--dry-run]');
  process.exit(1);
}
const staged = JSON.parse(fs.readFileSync(path.resolve(process.cwd(), stagedPath), 'utf-8'));
const cutoff = staged.cutoff;
const rows = staged.rows.filter((r) => r.date < cutoff);

const db = getDb();
const account = db.prepare('SELECT * FROM accounts WHERE name = ? AND archived = 0').get(ACCOUNT_NAME);
if (!account) {
  console.error(`Account "${ACCOUNT_NAME}" not found. Run the ODS import first.`);
  process.exit(1);
}

// 1. Guard: no history may exist before the cutoff
const historyCount = db
  .prepare('SELECT COUNT(*) AS c FROM transactions WHERE account_id = ? AND date < ?')
  .get(account.id, cutoff).c;
if (historyCount > 0) {
  console.error(`Account already has ${historyCount} transactions before ${cutoff}. History already imported — aborting.`);
  process.exit(1);
}

// 2. Resolve categories (create Transportes if needed)
const categoryIds = new Map();
for (const row of rows) {
  if (categoryIds.has(row.category)) continue;
  let cat = db
    .prepare('SELECT id FROM categories WHERE name = ? AND parent_id IS NULL AND archived = 0')
    .get(row.category);
  if (!cat && row.category === NEW_CATEGORY) {
    if (isDryRun) {
      cat = { id: -1 }; // placeholder for preview
    } else {
      const id = db.prepare('INSERT INTO categories (name, kind) VALUES (?, ?)').run(NEW_CATEGORY, 'expense').lastInsertRowid;
      cat = { id };
      console.log(`+ created category "${NEW_CATEGORY}" (expense)`);
    }
  }
  if (!cat) {
    console.error(`Category "${row.category}" does not exist in the database. Aborting.`);
    process.exit(1);
  }
  categoryIds.set(row.category, cat.id);
}

// 3. Dedupe against existing rows (idempotency safety net)
const existing = db
  .prepare('SELECT date, amount_cents, name FROM transactions WHERE account_id = ?')
  .all(account.id);
const existingCount = new Map();
for (const t of existing) {
  const k = `${t.date}|${t.amount_cents}|${t.name || ''}`;
  existingCount.set(k, (existingCount.get(k) || 0) + 1);
}
const seenInFile = new Map();
const toInsert = [];
let skipped = 0;
for (const row of rows) {
  const k = `${row.date}|${Math.abs(row.amount_cents)}|${row.name}`;
  const processed = seenInFile.get(k) || 0;
  seenInFile.set(k, processed + 1);
  if (processed < (existingCount.get(k) || 0)) {
    skipped++;
    continue;
  }
  toInsert.push(row);
}

const existingNet = db
  .prepare(`SELECT COALESCE(SUM(CASE WHEN type = 'income' THEN amount_cents WHEN type = 'expense' THEN -amount_cents ELSE 0 END), 0) AS net
            FROM transactions WHERE account_id = ? AND status = 'confirmed'`)
  .get(account.id).net;

const previewByCategory = new Map();
for (const row of toInsert) {
  const b = previewByCategory.get(row.category) || { n: 0, cents: 0 };
  b.n++;
  b.cents += row.amount_cents;
  previewByCategory.set(row.category, b);
}

const expectedBalance = staged.opening_balance_cents + existingNet + toInsert.reduce((s, r) => s + r.amount_cents, 0);

if (isDryRun) {
  console.log('=== DRY RUN (nothing written) ===');
  console.log(`account: "${ACCOUNT_NAME}" (id ${account.id})`);
  console.log(`opening balance: ${fmt(account.initial_balance_cents)} -> ${fmt(staged.opening_balance_cents)}`);
  console.log(`candidate rows: ${rows.length} | already present (dedupe skips): ${skipped} | to insert: ${toInsert.length}`);
  console.log(`existing confirmed net: ${fmt(existingNet)}`);
  console.log(`expected balance after import: ${fmt(expectedBalance)} (current: ${fmt(account.initial_balance_cents + existingNet)})`);
  console.log('\n-- per category (to insert) --');
  for (const [c, b] of [...previewByCategory.entries()].sort((a, b) => Math.abs(b[1].cents) - Math.abs(a[1].cents))) {
    console.log(`  ${c.padEnd(16)} ${String(b.n).padStart(4)} mvts ${fmt(b.cents)}`);
  }
  console.log('\nfirst/last rows to insert:');
  for (const row of [toInsert[0], toInsert[toInsert.length - 1]]) {
    console.log(`  ${row.date} ${row.name.padEnd(38)} ${fmt(row.amount_cents)} [${row.category}]`);
  }
} else {
  const insert = db.prepare(`
    INSERT INTO transactions (date, type, amount_cents, account_id, category_id, name, notes, status)
    VALUES (?, ?, ?, ?, ?, ?, ?, 'confirmed')
  `);
  let inserted = 0;
  const run = db.transaction(() => {
    db.prepare('UPDATE accounts SET initial_balance_cents = ? WHERE id = ?').run(staged.opening_balance_cents, account.id);
    for (const row of toInsert) {
      insert.run(
        row.date,
        row.amount_cents > 0 ? 'income' : 'expense',
        Math.abs(row.amount_cents),
        account.id,
        categoryIds.get(row.category),
        row.name,
        row.notes || null
      );
      inserted++;
    }
  });
  run();

  const balance = db
    .prepare(`SELECT a.initial_balance_cents + COALESCE(SUM(CASE WHEN t.type = 'income' THEN t.amount_cents WHEN t.type = 'expense' THEN -t.amount_cents ELSE 0 END), 0) AS balance
              FROM accounts a LEFT JOIN transactions t ON t.account_id = a.id AND t.status = 'confirmed'
              WHERE a.id = ? GROUP BY a.id`)
    .get(account.id).balance;

  console.log('=== IMPORT COMMITTED ===');
  console.log(`rows inserted: ${inserted} (skipped duplicates: ${skipped})`);
  console.log(`opening balance set to: ${fmt(staged.opening_balance_cents)}`);
  console.log(`final balance in DB: ${fmt(balance)} | expected: ${fmt(expectedBalance)}`);
  console.log(balance === expectedBalance ? 'RECONCILE: OK ✅' : 'RECONCILE: MISMATCH ❌');
}

function fmt(cents) {
  return ((cents / 100).toFixed(2) + ' €').replace('.', ',');
}
