import { z } from 'zod';

export const updateSettingsSchema = z
  .object({
    budget_method: z.enum(['50_30_20', 'zero_based', 'envelope']).optional()
  })
  .refine((data) => Object.keys(data).length > 0, {
    message: 'Indique pelo menos uma definição a actualizar'
  });
