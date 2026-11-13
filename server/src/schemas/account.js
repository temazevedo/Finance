import { z } from 'zod';

export const accountTypeSchema = z.enum(['checking', 'savings', 'cash', 'investment']);

export const createAccountSchema = z.object({
  name: z.string().trim().min(1, 'O nome da conta é obrigatório'),
  type: accountTypeSchema,
  initial_balance_cents: z.number().int('O saldo inicial deve ser um valor inteiro em cêntimos').default(0)
});

export const updateAccountSchema = z.object({
  name: z.string().trim().min(1, 'O nome da conta é obrigatório').optional(),
  type: accountTypeSchema.optional(),
  initial_balance_cents: z.number().int('O saldo inicial deve ser um valor inteiro em cêntimos').optional(),
  archived: z.union([z.boolean().transform((v) => (v ? 1 : 0)), z.literal(0), z.literal(1)]).optional()
});
