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
});
