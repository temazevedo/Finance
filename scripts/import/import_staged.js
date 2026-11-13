import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getDb } from '../../server/src/db.js';
import { runMigrations } from '../../server/src/migrate.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '../..');

/**
 * One-off importer for a staged movements JSON produced by
 * scripts/import/ods_to_staged.py.
 *
 * Usage:
 *   node scripts/import/import_staged.js imports/staged.json [--dry-run]
 *
 * Behaviour decisions confirmed with the user:
 * - Imports into a NEW account "CGD à Ordem" (checking) and archives "Conta Teste".
 * - Opening balance = implicit balance from the staged file (16023.80 EUR).
 * - Sheet categories are created verbatim as root leaf categories
 *   (income kind for "Rendimento" + TFR receipts; expense for the rest).
 * - Untitled TFR rows are split: positive -> "TFR Recebido" (income),
 *   negative -> "TFR Pago" (expense).
 * - ATM withdrawals ("Levantamento") stay as plain expense rows.
 */

const ACCOUNT_NAME = 'CGD à Ordem';
const OLD_ACCOUNT_NAME = 'Conta Teste';
const TFR_RECEIPT = 'TFR Recebido';
const TFR_PAYMENT = 'TFR Pago';
const INCOME_CATEGORIES = new Set(['Rendimento', TFR_RECEIPT]);

const stagedPath = process.argv[2];
const isDryRun = process.argv.includes('--dry-run');

if (!stagedPath) {
  console.error('Usage: node scripts/import/import_staged.js <staged.json> [--dry-run]');
  process.exit(1);
}
const stagedPathResolved = path.resolve(process.cwd(), stagedPath);
const staged = JSON.parse(fs.readFileSync(stagedPathResolved, 'utf-8'));

const db = getDb();
runMigrations(db);

const run = db.transaction(() => {
  const summary = { categoriesCreated: [], accountCreated: false, transactionsInserted: 0 };

  // 1. Create the import account and archive the old one
  const existing = db.prepare('SELECT * FROM accounts WHERE name = ? AND archived = 0').get(ACCOUNT_NAME);
  let accountId;
  if (existing) {
    if (existing.initial_balance_cents !== staged.opening_balance_cents) {
      throw new Error(
        `Account "${ACCOUNT_NAME}" already exists with a different opening balance (${existing.initial_balance_cents}).`
      );
    }
    accountId = existing.id;
  } else {
    accountId = db
      .prepare(
        'INSERT INTO accounts (name, type, initial_balance_cents) VALUES (?, ?, ?)'
      )
      .run(ACCOUNT_NAME, 'checking', staged.opening_balance_cents).lastInsertRowid;
    summary.accountCreated = true;
  }

  const oldAccount = db.prepare('SELECT * FROM accounts WHERE name = ? AND archived = 0').get(OLD_ACCOUNT_NAME);
  if (oldAccount && oldAccount.id !== accountId) {
    const hasTxs = db.prepare('SELECT COUNT(*) AS c FROM transactions WHERE account_id = ? OR to_account_id = ?')
      .get(oldAccount.id, oldAccount.id).c;
    if (hasTxs > 0 && !isDryRun) {
      throw new Error(
        `"${OLD_ACCOUNT_NAME}" has ${hasTxs} transactions; refusing to archive it automatically. Archive manually first.`
      );
    }
    if (!isDryRun) db.prepare('UPDATE accounts SET archived = 1 WHERE id = ?').run(oldAccount.id);
    summary.oldAccountArchived = true;
  }

  // 2. Create / resolve categories
  const ensureCategory = (name, kind) => {
    if (!name) return null;
    let row = db
      .prepare('SELECT id, kind FROM categories WHERE name = ? AND parent_id IS NULL AND archived = 0')
      .get(name);
    if (row) {
      if (row.kind !== kind) {
        throw new Error(`Category "${name}" exists with kind "${row.kind}" but import expects "${kind}".`);
      }
      return row.id;
    }
    const id = db
      .prepare('INSERT INTO categories (name, kind) VALUES (?, ?)')
      .run(name, kind).lastInsertRowid;
    summary.categoriesCreated.push(`${name} (${kind})`);
    return id;
  };

  const categoryIdBySheetName = new Map();
  for (const row of staged.rows) {
    let categoryName = row.category;
    if (!categoryName) {
      categoryName = row.amount_cents > 0 ? TFR_RECEIPT : TFR_PAYMENT;
    } else if (categoryName === 'Rendimento') {
      // keep as-is; income kind
    }
    const kind = INCOME_CATEGORIES.has(categoryName) ? 'income' : 'expense';
    let categoryId = categoryIdBySheetName.get(categoryName);
    if (!categoryId) {
      categoryId = ensureCategory(categoryName, kind);
      categoryIdBySheetName.set(categoryName, categoryId);
    }
    row._category_id = categoryId;
  }

  // 3. Insert transactions (confirmed). Guard against duplicates via an import tag in notes? No: verify the account is empty first.
  const txCount = db.prepare('SELECT COUNT(*) AS c FROM transactions WHERE account_id = ?').get(accountId).c;
  if (txCount > 0) {
    throw new Error(
      `Account "${ACCOUNT_NAME}" already contains ${txCount} transactions. Aborting to avoid duplicates.`
    );
  }

  const insert = db.prepare(`
    INSERT INTO transactions (date, type, amount_cents, account_id, category_id, name, notes, status)
    VALUES (?, ?, ?, ?, ?, ?, ?, 'confirmed')
  `);

  for (const row of staged.rows) {
    const type = row.amount_cents > 0 ? 'income' : 'expense';
    const result = insert.run(
      row.date,
      type,
      Math.abs(row.amount_cents),
      accountId,
      row._category_id,
      row.name.trim() || null,
      row.notes ? row.notes : null
    );
    summary.transactionsInserted += result.changes;
  }

  return summary;
});

// 4. Preview / commit
const drySummary = runSqlPreview();

function runSqlPreview() {
  // Dry-run preview built from staged data without touching the DB.
  const byCategory = new Map();
  let income = 0;
  let expense = 0;
  for (const row of staged.rows) {
    let cat = row.category || (row.amount_cents > 0 ? 'TFR Recebido' : 'TFR Pago');
    const bucket = byCategory.get(cat) || { count: 0, cents: 0 };
    bucket.count++;
    bucket.cents += row.amount_cents;
    byCategory.set(cat, bucket);
    if (row.amount_cents > 0) income += row.amount_cents;
    else expense += Math.abs(row.amount_cents);
  }
  return { byCategory, income, expense };
}

if (isDryRun) {
  console.log('=== DRY RUN (nothing written) ===');
  console.log(`account: "${ACCOUNT_NAME}" (opening ${fmt(staged.opening_balance_cents)})`);
  console.log(`rows: ${staged.rows.length} | incomes: ${fmt(drySummary.income)} | expenses: ${fmt(drySummary.expense)}`);
  console.log(`expected final balance: ${fmt(staged.opening_balance_cents + drySummary.income - drySummary.expense)}`);
  console.log(`continuity breaks in source: ${staged.continuity_breaks.length}`);
  console.log('\n-- per category --');
  for (const [cat, b] of drySummary.byCategory) {
    console.log(`  ${cat.padEnd(22)} ${String(b.count).padStart(3)} mvts  ${fmt(b.cents)}`);
  }
  console.log('\nfirst/last rows:');
  for (const row of [staged.rows[0], staged.rows[staged.rows.length - 1]]) {
    console.log(`  ${row.date} ${row.name.padEnd(40)} ${fmt(row.amount_cents)} [${row.category || '(TFR)'}]`);
  }
} else {
  const summary = run();
  console.log('=== IMPORT COMMITTED ===');
  console.log(`account: "${ACCOUNT_NAME}" (id ${accountIdOf(summary)})`);
  console.log(`new categories: ${summary.categoriesCreated.length}`);
  summary.categoriesCreated.forEach((c) => console.log(`  + ${c}`));
  console.log(`transactions inserted: ${summary.transactionsInserted}`);
  if (summary.oldAccountArchived) console.log(`archived: "${OLD_ACCOUNT_NAME}"`);

  // Reconcile against the sheet
  const account = db.prepare('SELECT * FROM accounts WHERE name = ?').get(ACCOUNT_NAME);
  const balanceCents = db
    .prepare(`
      SELECT a.initial_balance_cents +
        COALESCE(SUM(CASE WHEN t.type = 'income' THEN t.amount_cents
                          WHEN t.type = 'expense' THEN -t.amount_cents ELSE 0 END), 0) AS balance
      FROM accounts a LEFT JOIN transactions t ON t.account_id = a.id AND t.status = 'confirmed'
      WHERE a.id = ? GROUP BY a.id
    `)
    .get(account.id).balance;
  console.log(`\nfinal balance in DB: ${fmt(balanceCents)} | expected from sheet: ${fmt(staged.final_balance_cents)}`);
  console.log(balanceCents === staged.final_balance_cents ? 'RECONCILE: OK ✅' : 'RECONCILE: MISMATCH ❌');
}

function accountIdOf() {
  return db.prepare('SELECT id FROM accounts WHERE name = ?').get(ACCOUNT_NAME).id;
}

function fmt(cents) {
  return ((cents / 100).toFixed(2) + ' €').replace('.', ',');
}
