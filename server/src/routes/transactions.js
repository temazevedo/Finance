import { Router } from 'express';
import {
  createTransactionSchema,
  updateTransactionSchema,
  transactionQuerySchema
} from '../schemas/transaction.js';
import { transactionService } from '../services/transactionService.js';
import { validateBody, validateQuery } from '../utils/validation.js';

export const transactionsRouter = Router();

// GET /api/transactions - query transactions with filters and pagination
transactionsRouter.get('/', validateQuery(transactionQuerySchema), (req, res, next) => {
  try {
    const result = transactionService.listTransactions(req.query);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

// GET /api/transactions/:id - get single transaction
transactionsRouter.get('/:id', (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const tx = transactionService.getTransactionById(id);
    if (!tx) {
      return res.status(404).json({
        error: {
          code: 'NOT_FOUND',
          message: 'Transação não encontrada'
        }
      });
    }
    res.json(tx);
  } catch (err) {
    next(err);
  }
});

// POST /api/transactions - create transaction
transactionsRouter.post('/', validateBody(createTransactionSchema), (req, res, next) => {
  try {
    const tx = transactionService.createTransaction(req.body);
    res.status(201).json(tx);
  } catch (err) {
    next(err);
  }
});

// PATCH /api/transactions/:id - update transaction
transactionsRouter.patch('/:id', validateBody(updateTransactionSchema), (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const updated = transactionService.updateTransaction(id, req.body);
    if (!updated) {
      return res.status(404).json({
        error: {
          code: 'NOT_FOUND',
          message: 'Transação não encontrada'
        }
      });
    }
    res.json(updated);
  } catch (err) {
    next(err);
  }
});

// DELETE /api/transactions/:id - hard delete transaction
transactionsRouter.delete('/:id', (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const deleted = transactionService.deleteTransaction(id);
    if (!deleted) {
      return res.status(404).json({
        error: {
          code: 'NOT_FOUND',
          message: 'Transação não encontrada'
        }
      });
    }
    res.status(204).end();
  } catch (err) {
    next(err);
  }
});
