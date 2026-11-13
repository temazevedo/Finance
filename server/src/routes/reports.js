import { Router } from 'express';
import { cashflowQuerySchema, monthQuerySchema } from '../schemas/budget.js';
import { reportService } from '../services/reportService.js';
import { validateQuery } from '../utils/validation.js';

export const reportsRouter = Router();

// GET /api/reports/budget-vs-actual?month=YYYY-MM
reportsRouter.get('/budget-vs-actual', validateQuery(monthQuerySchema), (req, res, next) => {
  try {
    const report = reportService.getBudgetVsActual(req.query.month);
    res.json(report);
  } catch (err) {
    next(err);
  }
});

// GET /api/reports/cashflow?from=YYYY-MM-DD&to=YYYY-MM-DD
reportsRouter.get('/cashflow', validateQuery(cashflowQuerySchema), (req, res, next) => {
  try {
    const report = reportService.getCashflow(req.query.from, req.query.to);
    res.json(report);
  } catch (err) {
    next(err);
  }
});
