import { z } from 'zod';

export const suggestionQuerySchema = z.object({
  categoryId: z.coerce.number().int().positive('O identificador de categoria (categoryId) é obrigatório'),
  q: z.string().trim().optional().default('')
});
