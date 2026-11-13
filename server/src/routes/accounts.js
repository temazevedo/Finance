import { Router } from 'express';
import { createAccountSchema, updateAccountSchema } from '../schemas/account.js';
import { accountService } from '../services/accountService.js';
import { validateBody } from '../utils/validation.js';

export const accountsRouter = Router();

// GET /api/accounts - list accounts
accountsRouter.get('/', (req, res, next) => {
  try {
    const includeArchived = req.query.includeArchived === 'true' || req.query.includeArchived === '1';
    const accounts = accountService.listAccounts({ includeArchived });
    res.json(accounts);
  } catch (err) {
    next(err);
  }
});

// GET /api/accounts/balances - current balances per account
accountsRouter.get('/balances', (req, res, next) => {
  try {
    const includeArchived = req.query.includeArchived === 'true' || req.query.includeArchived === '1';
    const balances = accountService.getAccountBalances({ includeArchived });
    res.json(balances);
  } catch (err) {
    next(err);
  }
});

// GET /api/accounts/:id - single account
accountsRouter.get('/:id', (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const account = accountService.getAccountById(id);
    if (!account) {
      return res.status(404).json({
        error: {
          code: 'NOT_FOUND',
          message: 'Conta não encontrada'
        }
      });
    }
    res.json(account);
  } catch (err) {
    next(err);
  }
});

// POST /api/accounts - create account
accountsRouter.post('/', validateBody(createAccountSchema), (req, res, next) => {
  try {
    const account = accountService.createAccount(req.body);
    res.status(201).json(account);
  } catch (err) {
    if (err.message && err.message.includes('UNIQUE constraint failed')) {
      return res.status(409).json({
        error: {
          code: 'ACCOUNT_EXISTS',
          message: 'Já existe uma conta ativa com este nome'
        }
      });
    }
    next(err);
  }
});

// PATCH /api/accounts/:id - update account
accountsRouter.patch('/:id', validateBody(updateAccountSchema), (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const updated = accountService.updateAccount(id, req.body);
    if (!updated) {
      return res.status(404).json({
        error: {
          code: 'NOT_FOUND',
          message: 'Conta não encontrada'
        }
      });
    }
    res.json(updated);
  } catch (err) {
    if (err.message && err.message.includes('UNIQUE constraint failed')) {
      return res.status(409).json({
        error: {
          code: 'ACCOUNT_EXISTS',
          message: 'Já existe uma conta ativa com este nome'
        }
      });
    }
    next(err);
  }
});
