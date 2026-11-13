import { Router } from 'express';
import { createCategorySchema, updateCategorySchema } from '../schemas/category.js';
import { categoryService } from '../services/categoryService.js';
import { validateBody } from '../utils/validation.js';

export const categoriesRouter = Router();

// GET /api/categories - list categories
categoriesRouter.get('/', (req, res, next) => {
  try {
    const includeArchived = req.query.includeArchived === 'true' || req.query.includeArchived === '1';
    const categories = categoryService.listCategories({ includeArchived });
    res.json(categories);
  } catch (err) {
    next(err);
  }
});

// GET /api/categories/tree - list hierarchical tree
categoriesRouter.get('/tree', (req, res, next) => {
  try {
    const includeArchived = req.query.includeArchived === 'true' || req.query.includeArchived === '1';
    const tree = categoryService.getCategoryTree({ includeArchived });
    res.json(tree);
  } catch (err) {
    next(err);
  }
});

// GET /api/categories/:id - single category
categoriesRouter.get('/:id', (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const category = categoryService.getCategoryById(id);
    if (!category) {
      return res.status(404).json({
        error: {
          code: 'NOT_FOUND',
          message: 'Categoria não encontrada'
        }
      });
    }
    res.json(category);
  } catch (err) {
    next(err);
  }
});

// POST /api/categories - create category
categoriesRouter.post('/', validateBody(createCategorySchema), (req, res, next) => {
  try {
    const category = categoryService.createCategory(req.body);
    res.status(201).json(category);
  } catch (err) {
    if (err.message && err.message.includes('UNIQUE constraint failed')) {
      return res.status(409).json({
        error: {
          code: 'CATEGORY_EXISTS',
          message: 'Já existe uma categoria ativa com este nome sob a mesma categoria pai'
        }
      });
    }
    next(err);
  }
});

// PATCH /api/categories/:id - update category
categoriesRouter.patch('/:id', validateBody(updateCategorySchema), (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const updated = categoryService.updateCategory(id, req.body);
    if (!updated) {
      return res.status(404).json({
        error: {
          code: 'NOT_FOUND',
          message: 'Categoria não encontrada'
        }
      });
    }
    res.json(updated);
  } catch (err) {
    if (err.message && err.message.includes('UNIQUE constraint failed')) {
      return res.status(409).json({
        error: {
          code: 'CATEGORY_EXISTS',
          message: 'Já existe uma categoria ativa com este nome sob a mesma categoria pai'
        }
      });
    }
    next(err);
  }
});
