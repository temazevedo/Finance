import request from 'supertest';
import { describe, it, expect } from 'vitest';
import { app } from '../src/index.js';

describe('Categories API (/api/categories)', () => {
  it('lists categories with correct leaf indicators', async () => {
    const res = await request(app).get('/api/categories');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);

    const habitacao = res.body.find((c) => c.name === 'Habitação' && c.parent_id === null);
    expect(habitacao).toBeDefined();
    // Habitação has seeded subcategories, so it is NOT a leaf
    expect(habitacao.is_leaf).toBe(false);

    const renda = res.body.find((c) => c.name === 'Renda / Prestação');
    expect(renda).toBeDefined();
    // Renda is a child with no children, so it IS a leaf
    expect(renda.is_leaf).toBe(true);
  });

  it('returns categories structured as a tree', async () => {
    const res = await request(app).get('/api/categories/tree');
    expect(res.status).toBe(200);

    const habitacao = res.body.find((c) => c.name === 'Habitação');
    expect(habitacao).toBeDefined();
    expect(Array.isArray(habitacao.children)).toBe(true);
    expect(habitacao.children.length).toBeGreaterThan(0);
  });

  it('enforces maximum 2 levels of hierarchy', async () => {
    // 1. Create a top-level category
    const parentRes = await request(app).post('/api/categories').send({
      name: 'Animal de Estimação',
      kind: 'expense',
      budget_group: 'wants'
    });
    expect(parentRes.status).toBe(201);
    const parentId = parentRes.body.id;

    // 2. Create subcategory (level 2)
    const childRes = await request(app).post('/api/categories').send({
      name: 'Veterinário',
      kind: 'expense',
      parent_id: parentId,
      budget_group: 'wants'
    });
    expect(childRes.status).toBe(201);
    const childId = childRes.body.id;

    // 3. Attempt to create sub-subcategory under level 2 (should be rejected)
    const subChildRes = await request(app).post('/api/categories').send({
      name: 'Vacinas',
      kind: 'expense',
      parent_id: childId,
      budget_group: 'wants'
    });
    expect(subChildRes.status).toBe(400);
    expect(subChildRes.body.error.code).toBe('MAX_DEPTH_EXCEEDED');
  });

  it('marks standalone root category as leaf if it has no children', async () => {
    const res = await request(app).post('/api/categories').send({
      name: 'Donativos e Solidariedade',
      kind: 'expense',
      budget_group: 'wants'
    });
    expect(res.status).toBe(201);
    expect(res.body.is_leaf).toBe(true);
  });

  it('hard-deletes an unused leaf category', async () => {
    const created = await request(app).post('/api/categories').send({
      name: 'Categoria Temporária Delete',
      kind: 'expense'
    });
    expect(created.status).toBe(201);
    const id = created.body.id;

    const res = await request(app).delete(`/api/categories/${id}`);
    expect(res.status).toBe(200);
    expect(res.body.deleted).toBe(true);
    expect(res.body.archived).toBe(false);

    // Gone from the active list
    const list = await request(app).get('/api/categories');
    expect(list.body.find((c) => c.id === id)).toBeUndefined();
  });

  it('archives a category with transactions instead of deleting it', async () => {
    const created = await request(app).post('/api/categories').send({
      name: 'Categoria Em Uso Delete',
      kind: 'expense'
    });
    const id = created.body.id;

    // Create a transaction referencing the category
    const account = await request(app).post('/api/accounts').send({
      name: 'Conta Categorias Delete',
      type: 'checking',
      initial_balance_cents: 10000
    });
    const tx = await request(app).post('/api/transactions').send({
      date: '2026-01-15',
      type: 'expense',
      amount_cents: 1000,
      name: 'Teste',
      category_id: id,
      account_id: account.body.id
    });
    expect(tx.status).toBe(201);

    const res = await request(app).delete(`/api/categories/${id}`);
    expect(res.status).toBe(200);
    expect(res.body.archived).toBe(true);
    expect(res.body.deleted).toBe(false);

    // Not in the active list, but still exists as archived
    const list = await request(app).get('/api/categories');
    expect(list.body.find((c) => c.id === id)).toBeUndefined();
    const archived = await request(app).get('/api/categories?includeArchived=true');
    expect(archived.body.find((c) => c.id === id)?.archived).toBe(1);
  });

  it('archives a parent with children and cascades when a descendant is referenced', async () => {
    const parent = await request(app).post('/api/categories').send({
      name: 'Pai Para Arquivar Delete',
      kind: 'expense'
    });
    const parentId = parent.body.id;
    const child = await request(app).post('/api/categories').send({
      name: 'Filho Para Arquivar Delete',
      kind: 'expense',
      parent_id: parentId
    });
    expect(child.status).toBe(201);

    // A transaction on the CHILD makes the whole subtree "in use"
    const account = await request(app).post('/api/accounts').send({
      name: 'Conta Arquivar Delete',
      type: 'checking',
      initial_balance_cents: 10000
    });
    const tx = await request(app).post('/api/transactions').send({
      date: '2026-01-15',
      type: 'expense',
      amount_cents: 1000,
      name: 'Teste',
      category_id: child.body.id,
      account_id: account.body.id
    });
    expect(tx.status).toBe(201);

    const res = await request(app).delete(`/api/categories/${parentId}`);
    expect(res.status).toBe(200);
    expect(res.body.archived).toBe(true);
    expect(res.body.archived_children).toBe(1);

    const archived = await request(app).get('/api/categories?includeArchived=true');
    expect(archived.body.find((c) => c.id === parentId)?.archived).toBe(1);
    expect(archived.body.find((c) => c.id === child.body.id)?.archived).toBe(1);
  });

  it('hard-deletes an unused parent together with its unused children', async () => {
    const parent = await request(app).post('/api/categories').send({
      name: 'Pai Para Apagar Delete',
      kind: 'expense'
    });
    const parentId = parent.body.id;
    const child = await request(app).post('/api/categories').send({
      name: 'Filho Para Apagar Delete',
      kind: 'expense',
      parent_id: parentId
    });
    expect(child.status).toBe(201);

    const res = await request(app).delete(`/api/categories/${parentId}`);
    expect(res.status).toBe(200);
    expect(res.body.deleted).toBe(true);
    expect(res.body.deleted_children).toBeGreaterThanOrEqual(1);

    const archived = await request(app).get('/api/categories?includeArchived=true');
    expect(archived.body.find((c) => c.id === parentId)).toBeUndefined();
    expect(archived.body.find((c) => c.id === child.body.id)).toBeUndefined();
  });

  it('returns 404 when deleting a non-existent category', async () => {
    const res = await request(app).delete('/api/categories/999999');
    expect(res.status).toBe(404);
  });

  it('blocks changing kind when active children have the current kind', async () => {
    const parent = await request(app).post('/api/categories').send({
      name: 'Pai Tipo Bloqueado Delete',
      kind: 'expense'
    });
    const parentId = parent.body.id;
    await request(app).post('/api/categories').send({
      name: 'Filho Tipo Bloqueado Delete',
      kind: 'expense',
      parent_id: parentId
    });

    const res = await request(app).patch(`/api/categories/${parentId}`).send({ kind: 'income' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('KIND_MISMATCH_CHILDREN');
  });

  it('blocks moving a category with children under another parent', async () => {
    const parent = await request(app).post('/api/categories').send({
      name: 'Pai Movido Delete',
      kind: 'expense'
    });
    const parentId = parent.body.id;
    await request(app).post('/api/categories').send({
      name: 'Filho Movido Delete',
      kind: 'expense',
      parent_id: parentId
    });

    const other = await request(app).post('/api/categories').send({
      name: 'Outro Pai Delete',
      kind: 'expense'
    });

    const res = await request(app).patch(`/api/categories/${parentId}`).send({
      parent_id: other.body.id
    });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('HAS_CHILDREN');
  });
});
