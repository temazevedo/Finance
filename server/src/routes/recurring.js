import { Router } from 'express';
import {
  createRecurringSchema,
  updateRecurringSchema,
  recurringQuerySchema
} from '../schemas/recurring.js';
import { recurringService } from '../services/recurringService.js';
import { validateBody, validateQuery } from '../utils/validation.js';

export const recurringRouter = Router();

// GET /api/recurring - list recurring items
recurringRouter.get('/', validateQuery(recurringQuerySchema), (req, res, next) => {
  try {
    const items = recurringService.listRecurring(req.query);
    res.json(items);
  } catch (err) {
    next(err);
  }
});

// GET /api/recurring/summary - monthly equivalent totals and surplus
recurringRouter.get('/summary', (req, res, next) => {
  try {
    const summary = recurringService.getMonthlySummary();
    res.json(summary);
  } catch (err) {
    next(err);
  }
});

// GET /api/recurring/:id - single recurring item
recurringRouter.get('/:id', (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const item = recurringService.getRecurringById(id);
    if (!item) {
      return res.status(404).json({
        error: {
          code: 'NOT_FOUND',
          message: 'Item recorrente não encontrado'
        }
      });
    }
    res.json(item);
  } catch (err) {
    next(err);
  }
});

// POST /api/recurring - create recurring item
recurringRouter.post('/', validateBody(createRecurringSchema), (req, res, next) => {
  try {
    const created = recurringService.createRecurring(req.body);
    res.status(201).json(created);
  } catch (err) {
    next(err);
  }
});

// PATCH /api/recurring/:id - update recurring item
recurringRouter.patch('/:id', validateBody(updateRecurringSchema), (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const updated = recurringService.updateRecurring(id, req.body);
    if (!updated) {
      return res.status(404).json({
        error: {
          code: 'NOT_FOUND',
          message: 'Item recorrente não encontrado'
        }
      });
    }
    res.json(updated);
  } catch (err) {
    next(err);
  }
});

// DELETE /api/recurring/:id - deactivate recurring item
recurringRouter.delete('/:id', (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const deactivated = recurringService.deactivateRecurring(id);
    if (!deactivated) {
      return res.status(404).json({
        error: {
          code: 'NOT_FOUND',
          message: 'Item recorrente não encontrado'
        }
      });
    }
    res.json(deactivated);
  } catch (err) {
    next(err);
  }
});
