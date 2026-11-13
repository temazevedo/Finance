import { Router } from 'express';
import { budgetUpsertSchema, monthQuerySchema } from '../schemas/budget.js';
import { budgetService } from '../services/budgetService.js';
import { validateBody, validateQuery } from '../utils/validation.js';

export const budgetsRouter = Router();

// GET /api/budgets?month=YYYY-MM - list budgets for a month
budgetsRouter.get('/', validateQuery(monthQuerySchema), (req, res, next) => {
  try {
    const budgets = budgetService.listBudgets(req.query.month);
    res.json({ month: req.query.month, budgets });
  } catch (err) {
    next(err);
  }
});

// PUT /api/budgets?month=YYYY-MM - bulk upsert budgets for a month
budgetsRouter.put(
  '/',
  validateQuery(monthQuerySchema),
  validateBody(budgetUpsertSchema),
  (req, res, next) => {
    try {
      const budgets = budgetService.upsertBudgets(req.query.month, req.body.budgets);
      res.json({ month: req.query.month, budgets });
    } catch (err) {
      next(err);
    }
  }
);
