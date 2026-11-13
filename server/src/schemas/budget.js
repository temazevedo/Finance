import { z } from 'zod';

const MONTH_REGEX = /^\d{4}-(0[1-9]|1[0-2])$/;

export const monthQuerySchema = z.object({
  month: z
    .string()
    .regex(MONTH_REGEX, 'Mês inválido. Use o formato AAAA-MM (ex: 2026-02)')
});

export const budgetUpsertSchema = z.object({
  budgets: z
    .array(
      z.object({
        category_id: z.number().int().positive('A categoria é obrigatória'),
        amount_cents: z
          .number()
          .int()
          .min(0, 'O montante do orçamento não pode ser negativo')
          .max(9999999999, 'O montante do orçamento é excessivamente elevado')
      })
    )
    .max(500, 'Demasiadas categorias no pedido')
});

export const cashflowQuerySchema = z.object({
  from: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'Data inválida. Use o formato AAAA-MM-DD'),
  to: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'Data inválida. Use o formato AAAA-MM-DD')
});
