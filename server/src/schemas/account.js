import { z } from 'zod';

export const accountTypeSchema = z.enum(['checking', 'savings', 'cash', 'investment']);
export const interestPeriodSchema = z.enum(['monthly', 'annual']);
export const interestRateSchema = z.number().min(0, 'A taxa de juro não pode ser negativa').max(100, 'A taxa de juro não pode exceder 100%');

const noInterestUnlessInvestment = (data) => {
  const hasInterest = data.interest_rate !== null && data.interest_rate !== undefined ||
    data.interest_period !== null && data.interest_period !== undefined;
  return !hasInterest || data.type === 'investment';
};

export const createAccountSchema = z.object({
  name: z.string().trim().min(1, 'O nome da conta é obrigatório'),
  type: accountTypeSchema,
  initial_balance_cents: z.number().int('O saldo inicial deve ser um valor inteiro em cêntimos').default(0),
  interest_rate: interestRateSchema.nullable().optional().default(null),
  interest_period: interestPeriodSchema.nullable().optional().default(null)
}).refine(noInterestUnlessInvestment, {
  message: 'A taxa de juro só se aplica a contas de investimento',
  path: ['interest_rate']
});

export const updateAccountSchema = z.object({
  name: z.string().trim().min(1, 'O nome da conta é obrigatório').optional(),
  type: accountTypeSchema.optional(),
  initial_balance_cents: z.number().int('O saldo inicial deve ser um valor inteiro em cêntimos').optional(),
  interest_rate: interestRateSchema.nullable().optional(),
  interest_period: interestPeriodSchema.nullable().optional(),
  archived: z.union([z.boolean().transform((v) => (v ? 1 : 0)), z.literal(0), z.literal(1)]).optional()
});
