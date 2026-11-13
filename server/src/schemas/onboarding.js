import { z } from 'zod';

export const saveStepSchema = z.object({
  step: z.number().int().min(1).max(5),
  // Optional structured wizard payload (e.g. step 4 variable budgets), stored as JSON in settings
  data: z.unknown().optional()
});

export const completeOnboardingSchema = z.object({
  budgets: z
    .array(
      z.object({
        category_id: z.number().int().positive(),
        amount_cents: z.number().int().min(0)
      })
    )
    .optional()
    .default([])
});
