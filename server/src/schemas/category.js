import { z } from 'zod';

export const categoryKindSchema = z.enum(['income', 'expense']);
export const budgetGroupSchema = z.enum(['needs', 'wants', 'savings']).nullable().optional();

export const createCategorySchema = z.object({
  name: z.string().trim().min(1, 'O nome da categoria é obrigatório'),
  kind: categoryKindSchema,
  parent_id: z.number().int().positive().nullable().optional().default(null),
  budget_group: budgetGroupSchema.default(null)
}).refine(
  (data) => {
    // Income categories should not have budget_group
    if (data.kind === 'income' && data.budget_group) {
      return false;
    }
    return true;
  },
  { message: 'Categorias de rendimento não devem ter grupo de orçamento (budget_group)', path: ['budget_group'] }
);

export const updateCategorySchema = z.object({
  name: z.string().trim().min(1, 'O nome da categoria é obrigatório').optional(),
  kind: categoryKindSchema.optional(),
  parent_id: z.number().int().positive().nullable().optional(),
  budget_group: budgetGroupSchema,
  archived: z.union([z.boolean().transform((v) => (v ? 1 : 0)), z.literal(0), z.literal(1)]).optional()
});
