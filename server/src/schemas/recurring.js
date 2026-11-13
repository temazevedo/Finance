import { z } from 'zod';
import { isValidDateString } from '../utils/date.js';

export const recurringFrequencySchema = z.enum([
  'weekly',
  'biweekly',
  'monthly',
  'bimonthly',
  'quarterly',
  'semiannual',
  'annual'
]);

export const recurringTypeSchema = z.enum(['income', 'expense', 'transfer']);

const dateStringSchema = z.string().refine(isValidDateString, {
  message: 'Data inválida. Use o formato AAAA-MM-DD (ex: 2026-05-31)'
});

export const createRecurringSchema = z
  .object({
    type: recurringTypeSchema,
    name: z.string().trim().min(1, 'A designação é obrigatória'),
    account_id: z.number().int().positive('A conta é obrigatória'),
    to_account_id: z.number().int().positive().nullable().optional().default(null),
    category_id: z.number().int().positive().nullable().optional().default(null),
    amount_cents: z.number().int().positive('O montante tem de ser superior a zero'),
    is_estimate: z.union([z.boolean().transform((v) => (v ? 1 : 0)), z.literal(0), z.literal(1)]).default(0),
    frequency: recurringFrequencySchema,
    start_date: dateStringSchema,
    end_date: dateStringSchema.nullable().optional().default(null),
    active: z.union([z.boolean().transform((v) => (v ? 1 : 0)), z.literal(0), z.literal(1)]).default(1)
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
          message: 'A conta de destino deve ser diferente da conta de origem',
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
          message: 'A categoria é obrigatória para despesas e receitas',
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

    if (data.end_date && data.end_date < data.start_date) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'A data de fim não pode ser anterior à data de início',
        path: ['end_date']
      });
    }
  });

export const updateRecurringSchema = z
  .object({
    type: recurringTypeSchema.optional(),
    name: z.string().trim().min(1, 'A designação é obrigatória').optional(),
    account_id: z.number().int().positive('A conta é obrigatória').optional(),
    to_account_id: z.number().int().positive().nullable().optional(),
    category_id: z.number().int().positive().nullable().optional(),
    amount_cents: z.number().int().positive('O montante tem de ser superior a zero').optional(),
    is_estimate: z.union([z.boolean().transform((v) => (v ? 1 : 0)), z.literal(0), z.literal(1)]).optional(),
    frequency: recurringFrequencySchema.optional(),
    start_date: dateStringSchema.optional(),
    end_date: dateStringSchema.nullable().optional(),
    active: z.union([z.boolean().transform((v) => (v ? 1 : 0)), z.literal(0), z.literal(1)]).optional()
  })
  .superRefine((data, ctx) => {
    if (data.type === 'transfer') {
      if (data.to_account_id !== undefined && data.account_id !== undefined && data.to_account_id === data.account_id) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'A conta de destino deve ser diferente da conta de origem',
          path: ['to_account_id']
        });
      }
    }
    if (data.start_date && data.end_date && data.end_date < data.start_date) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'A data de fim não pode ser anterior à data de início',
        path: ['end_date']
      });
    }
  });

export const recurringQuerySchema = z.object({
  type: recurringTypeSchema.optional(),
  active: z.coerce.number().int().min(0).max(1).optional()
});
