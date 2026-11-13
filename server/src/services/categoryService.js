import { getDb } from '../db.js';

export class CategoryService {
  /**
   * @param {import('better-sqlite3').Database} [db]
   */
  constructor(db) {
    this.db = db || getDb();
  }

  /**
   * Lists categories, with an `is_leaf` boolean indicating whether the category has no children.
   */
  listCategories({ includeArchived = false } = {}) {
    let whereClause = '';
    if (!includeArchived) {
      whereClause = 'WHERE c.archived = 0';
    }

    const sql = `
      SELECT
        c.id,
        c.parent_id,
        c.name,
        c.kind,
        c.budget_group,
        c.archived,
        p.name AS parent_name,
        CASE
          WHEN (SELECT COUNT(*) FROM categories child WHERE child.parent_id = c.id AND child.archived = 0) = 0
          THEN 1
          ELSE 0
        END AS is_leaf
      FROM categories c
      LEFT JOIN categories p ON c.parent_id = p.id
      ${whereClause}
      ORDER BY COALESCE(c.parent_id, c.id) ASC, c.parent_id IS NOT NULL, c.name ASC
    `;

    const rows = this.db.prepare(sql).all();
    return rows.map((r) => ({
      ...r,
      is_leaf: Boolean(r.is_leaf)
    }));
  }

  /**
   * Returns categories structured as a tree (parents with children array).
   */
  getCategoryTree({ includeArchived = false } = {}) {
    const list = this.listCategories({ includeArchived });
    const parents = list.filter((c) => c.parent_id === null);
    const childrenByParent = new Map();

    for (const item of list) {
      if (item.parent_id !== null) {
        if (!childrenByParent.has(item.parent_id)) {
          childrenByParent.set(item.parent_id, []);
        }
        childrenByParent.get(item.parent_id).push(item);
      }
    }

    return parents.map((parent) => ({
      ...parent,
      children: childrenByParent.get(parent.id) || []
    }));
  }

  /**
   * Gets a single category by ID.
   */
  getCategoryById(id) {
    const sql = `
      SELECT
        c.*,
        p.name AS parent_name,
        CASE
          WHEN (SELECT COUNT(*) FROM categories child WHERE child.parent_id = c.id AND child.archived = 0) = 0
          THEN 1
          ELSE 0
        END AS is_leaf
      FROM categories c
      LEFT JOIN categories p ON c.parent_id = p.id
      WHERE c.id = ?
    `;
    const row = this.db.prepare(sql).get(id);
    if (!row) return null;
    return {
      ...row,
      is_leaf: Boolean(row.is_leaf)
    };
  }

  /**
   * Checks whether a category is an active leaf category (no active children).
   * @param {number} id
   * @returns {boolean}
   */
  isLeafCategory(id) {
    const category = this.getCategoryById(id);
    if (!category || category.archived === 1) {
      return false;
    }
    return category.is_leaf;
  }

  /**
   * Creates a new category enforcing the 2-level hierarchy rule.
   */
  createCategory({ name, kind, parent_id = null, budget_group = null }) {
    if (parent_id !== null) {
      const parent = this.getCategoryById(parent_id);
      if (!parent) {
        const error = new Error('A categoria superior selecionada não existe');
        error.code = 'INVALID_PARENT';
        error.status = 400;
        throw error;
      }
      if (parent.parent_id !== null) {
        const error = new Error('A hierarquia de categorias só pode ter no máximo 2 níveis (Pai → Filho)');
        error.code = 'MAX_DEPTH_EXCEEDED';
        error.status = 400;
        throw error;
      }
      // Inherit kind from parent if not matching
      if (parent.kind !== kind) {
        const error = new Error(`A subcategoria deve ter o mesmo tipo da categoria pai (${parent.kind})`);
        error.code = 'KIND_MISMATCH';
        error.status = 400;
        throw error;
      }
    }

    const stmt = this.db.prepare(`
      INSERT INTO categories (name, kind, parent_id, budget_group)
      VALUES (?, ?, ?, ?)
    `);
    const result = stmt.run(name, kind, parent_id, budget_group);
    return this.getCategoryById(result.lastInsertRowid);
  }

  /**
   * Deletes a category.
   *
   * Semantics:
   * - If the category or any of its descendants is referenced by transactions,
   *   recurring items or budgets, the category and its active children are
   *   ARCHIVED (soft delete) so history stays intact.
   * - Otherwise the category is hard-deleted. If it has children (all unused
   *   in that case), the whole subtree is hard-deleted.
   *
   * @param {number} id
   * @returns {null | { archived: boolean, deleted: boolean, archived_children?: number, deleted_children?: number }}
   */
  deleteCategory(id) {
    const category = this.getCategoryById(id);
    if (!category) {
      return null;
    }

    const childIds = this.db
      .prepare('SELECT id FROM categories WHERE parent_id = ?')
      .all(id)
      .map((r) => r.id);
    const allIds = [id, ...childIds];
    const placeholders = allIds.map(() => '?').join(', ');

    const referenced =
      this.db.prepare(`SELECT COUNT(*) c FROM transactions WHERE category_id IN (${placeholders})`).get(...allIds).c +
      this.db.prepare(`SELECT COUNT(*) c FROM recurring_items WHERE category_id IN (${placeholders})`).get(...allIds).c +
      this.db.prepare(`SELECT COUNT(*) c FROM budgets WHERE category_id IN (${placeholders})`).get(...allIds).c;

    const activeChildren = this.db
      .prepare('SELECT COUNT(*) c FROM categories WHERE parent_id = ? AND archived = 0')
      .get(id).c;

    if (referenced > 0) {
      const archiveSelf = this.db.prepare('UPDATE categories SET archived = 1 WHERE id = ?');
      const archiveChildren = this.db.prepare('UPDATE categories SET archived = 1 WHERE parent_id = ? AND archived = 0');
      const run = this.db.transaction(() => {
        archiveChildren.run(id);
        archiveSelf.run(id);
      });
      run();
      return { archived: true, deleted: false, archived_children: activeChildren };
    }

    const run = this.db.transaction(() => {
      this.db.prepare('DELETE FROM categories WHERE parent_id = ?').run(id);
      this.db.prepare('DELETE FROM categories WHERE id = ?').run(id);
    });
    run();
    return { deleted: true, archived: false, deleted_children: childIds.length };
  }

  /**
   * Updates an existing category.
   */
  updateCategory(id, updates) {
    const existing = this.getCategoryById(id);
    if (!existing) {
      return null;
    }

    if (updates.parent_id !== undefined && updates.parent_id !== null) {
      if (updates.parent_id === id) {
        const error = new Error('Uma categoria não pode ser pai de si própria');
        error.code = 'CYCLIC_PARENT';
        error.status = 400;
        throw error;
      }
      const newParent = this.getCategoryById(updates.parent_id);
      if (!newParent) {
        const error = new Error('A categoria superior selecionada não existe');
        error.code = 'INVALID_PARENT';
        error.status = 400;
        throw error;
      }
      if (newParent.parent_id !== null) {
        const error = new Error('A hierarquia de categorias só pode ter no máximo 2 níveis');
        error.code = 'MAX_DEPTH_EXCEEDED';
        error.status = 400;
        throw error;
      }
      // A category that has children cannot become a child itself (children would be depth 3)
      const childCount = this.db.prepare('SELECT COUNT(*) c FROM categories WHERE parent_id = ?').get(id).c;
      if (childCount > 0) {
        const error = new Error('Uma categoria com subcategorias não pode ser movida para baixo de outra categoria');
        error.code = 'HAS_CHILDREN';
        error.status = 400;
        throw error;
      }
    }

    // Changing kind is only allowed when there are no active children of the other kind
    if (updates.kind !== undefined && updates.kind !== existing.kind) {
      const mismatchedChildren = this.db
        .prepare('SELECT COUNT(*) c FROM categories WHERE parent_id = ? AND archived = 0 AND kind != ?')
        .get(id, updates.kind).c;
      if (mismatchedChildren > 0) {
        const error = new Error('Não é possível alterar o tipo: existem subcategorias com o tipo atual');
        error.code = 'KIND_MISMATCH_CHILDREN';
        error.status = 400;
        throw error;
      }
    }

    const fields = [];
    const values = [];

    if (updates.name !== undefined) {
      fields.push('name = ?');
      values.push(updates.name);
    }
    if (updates.kind !== undefined) {
      fields.push('kind = ?');
      values.push(updates.kind);
    }
    if (updates.parent_id !== undefined) {
      fields.push('parent_id = ?');
      values.push(updates.parent_id);
    }
    if (updates.budget_group !== undefined) {
      fields.push('budget_group = ?');
      values.push(updates.budget_group);
    }
    if (updates.archived !== undefined) {
      fields.push('archived = ?');
      values.push(updates.archived);
    }

    if (fields.length === 0) {
      return existing;
    }

    values.push(id);
    const sql = `UPDATE categories SET ${fields.join(', ')} WHERE id = ?`;
    this.db.prepare(sql).run(...values);

    return this.getCategoryById(id);
  }
}

export const categoryService = new CategoryService();
