import { z } from 'zod';
import { isValidDateString } from '../utils/date.js';

export const transactionTypeSchema = z.enum(['income', 'expense', 'transfer']);
export const transactionStatusSchema = z.enum(['planned', 'confirmed']);

const dateStringSchema = z.string().refine(isValidDateString, {
  message: 'Data inválida. Use o formato AAAA-MM-DD (ex: 2026-05-31)'
});

export const createTransactionSchema = z
  .object({
    date: dateStringSchema,
    type: transactionTypeSchema,
    amount_cents: z.number().int().positive('O montante deve ser superior a zero'),
    account_id: z.number().int().positive('A conta é obrigatória'),
    to_account_id: z.number().int().positive().nullable().optional().default(null),
    category_id: z.number().int().positive().nullable().optional().default(null),
    name: z.string().trim().nullable().optional().default(null),
    notes: z.string().trim().nullable().optional().default(null),
    status: transactionStatusSchema.default('confirmed')
  })
  .superRefine((data, ctx) => {
    if (data.type === 'transfer') {
      if (!data.to_account_id) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'A conta de destino é obrigatória para transferências',
          path: ['to_account_id']
        });
      } else if (data.to_account_id === data.account_id) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'A conta de destino tem de ser diferente da conta de origem',
          path: ['to_account_id']
        });
      }
      if (data.category_id !== null && data.category_id !== undefined) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'Transferências não devem ter categoria associada',
          path: ['category_id']
        });
      }
    } else {
      if (!data.category_id) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'A categoria é obrigatória para receitas e despesas',
          path: ['category_id']
        });
      }
      if (data.to_account_id !== null && data.to_account_id !== undefined) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'Conta de destino só é permitida em transferências',
          path: ['to_account_id']
        });
      }
    }
  });

export const updateTransactionSchema = z
  .object({
    date: dateStringSchema.optional(),
    type: transactionTypeSchema.optional(),
    amount_cents: z.number().int().positive('O montante deve ser superior a zero').optional(),
    account_id: z.number().int().positive().optional(),
    to_account_id: z.number().int().positive().nullable().optional(),
    category_id: z.number().int().positive().nullable().optional(),
    name: z.string().trim().nullable().optional(),
    notes: z.string().trim().nullable().optional(),
    status: transactionStatusSchema.optional()
  })
  .superRefine((data, ctx) => {
    if (data.type === 'transfer') {
      if (data.to_account_id !== undefined && data.account_id !== undefined && data.to_account_id === data.account_id) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'A conta de destino tem de ser diferente da conta de origem',
          path: ['to_account_id']
        });
      }
    }
  });

export const transactionQuerySchema = z.object({
  from: dateStringSchema.optional(),
  to: dateStringSchema.optional(),
  account_id: z.coerce.number().int().positive().optional(),
  category_id: z.coerce.number().int().positive().optional(),
  type: transactionTypeSchema.optional(),
  status: transactionStatusSchema.optional(),
  q: z.string().trim().optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(200).default(50)
});
