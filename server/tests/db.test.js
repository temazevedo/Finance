import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createDatabase } from '../src/db.js';
import { runMigrations } from '../src/migrate.js';

describe('Database and Migrations', () => {
  let db;

  beforeEach(() => {
    // In-memory database for fast, isolated tests
    db = createDatabase(':memory:');
    runMigrations(db);
  });

  afterEach(() => {
    db.close();
  });

  it('enforces foreign keys pragma', () => {
    const row = db.pragma('foreign_keys', { simple: true });
    expect(row).toBe(1);
  });

  it('runs migrations and creates expected tables', () => {
    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'")
      .all()
      .map((t) => t.name);

    expect(tables).toContain('accounts');
    expect(tables).toContain('categories');
    expect(tables).toContain('transactions');
    expect(tables).toContain('budgets');
    expect(tables).toContain('recurring_items');
    expect(tables).toContain('skipped_occurrences');
    expect(tables).toContain('settings');
    expect(tables).toContain('_migrations');
  });

  it('seeds default categories with leaf nodes and budget groups', () => {
    const parentCategories = db.prepare('SELECT * FROM categories WHERE parent_id IS NULL').all();
    expect(parentCategories.length).toBeGreaterThan(5);

    const habitacao = parentCategories.find((c) => c.name === 'Habitação');
    expect(habitacao).toBeDefined();
    expect(habitacao.budget_group).toBe('needs');

    const children = db.prepare('SELECT * FROM categories WHERE parent_id = ?').all(habitacao.id);
    expect(children.length).toBeGreaterThan(0);
    expect(children.some((c) => c.name === 'Renda / Prestação')).toBe(true);

    const rendimentos = parentCategories.find((c) => c.name === 'Rendimentos');
    expect(rendimentos).toBeDefined();
    expect(rendimentos.kind).toBe('income');
  });

  it('allows duplicate names if previous record is archived (partial unique index)', () => {
    db.prepare("INSERT INTO accounts (name, type) VALUES ('Conta Principal', 'checking')").run();

    // Archiving the first account
    db.prepare("UPDATE accounts SET archived = 1 WHERE name = 'Conta Principal'").run();

    // Inserting a new active account with the same name should succeed due to WHERE archived = 0
    expect(() => {
      db.prepare("INSERT INTO accounts (name, type) VALUES ('Conta Principal', 'checking')").run();
    }).not.toThrow();

    // Inserting another active account with that name should fail
    expect(() => {
      db.prepare("INSERT INTO accounts (name, type) VALUES ('Conta Principal', 'checking')").run();
    }).toThrow();
  });

  it('cascades deletion on skipped_occurrences when recurring_item is deleted', () => {
    const accountResult = db.prepare("INSERT INTO accounts (name, type) VALUES ('Conta Teste', 'checking')").run();
    const accountId = accountResult.lastInsertRowid;

    const cat = db.prepare("SELECT id FROM categories WHERE parent_id IS NOT NULL LIMIT 1").get();

    const recurringResult = db.prepare(`
      INSERT INTO recurring_items (name, type, category_id, account_id, amount_cents, frequency, start_date)
      VALUES ('Internet', 'expense', ?, ?, 3500, 'monthly', '2026-01-01')
    `).run(cat.id, accountId);
    const recurringId = recurringResult.lastInsertRowid;

    db.prepare('INSERT INTO skipped_occurrences (recurring_id, date) VALUES (?, ?)').run(recurringId, '2026-02-01');

    const before = db.prepare('SELECT * FROM skipped_occurrences WHERE recurring_id = ?').all(recurringId);
    expect(before.length).toBe(1);

    db.prepare('DELETE FROM recurring_items WHERE id = ?').run(recurringId);

    const after = db.prepare('SELECT * FROM skipped_occurrences WHERE recurring_id = ?').all(recurringId);
    expect(after.length).toBe(0);
  });
});
