import { z } from 'zod';

/**
 * Import profile config (AGENT.md section 14.2). Stored as JSON in
 * import_profiles.config_json and applied deterministically by the parser.
 */
export const cleanupRuleSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('strip_prefix'), value: z.string().min(1) }),
  z.object({ type: z.literal('strip_suffix'), value: z.string().min(1) }),
  z.object({ type: z.literal('replace'), value: z.string().min(1), replacement: z.string() }),
  z.object({ type: z.literal('trim') })
]);

export const profileConfigSchema = z
  .object({
    encoding: z.enum(['utf8', 'windows-1252']).default('utf8'),
    delimiter: z.string().min(1).max(1).default(';'),
    skip_rows: z.number().int().min(0).default(0),
    has_header_row: z.boolean().default(false),
    date_format: z.enum(['DD/MM/YYYY', 'DD-MM-YYYY', 'YYYY-MM-DD', 'DD/MM/YY']).default('DD-MM-YYYY'),
    decimal_separator: z.enum([',', '.']).default(','),
    thousand_separator: z.enum(['.', ',', '', ' ']).default('.'),
    // 0-based column indexes; either `amount` alone (signed) or debit/credit pair
    columns: z.object({
      date: z.number().int().min(0),
      description: z.number().int().min(0),
      amount: z.number().int().min(0).nullable().optional(),
      debit: z.number().int().min(0).nullable().optional(),
      credit: z.number().int().min(0).nullable().optional()
    }),
    cleanup_rules: z.array(cleanupRuleSchema).max(10).default([])
  })
  .refine(
    (cfg) =>
      cfg.columns.amount !== undefined && cfg.columns.amount !== null
        ? true
        : cfg.columns.debit !== undefined &&
          cfg.columns.debit !== null &&
          cfg.columns.credit !== undefined &&
          cfg.columns.credit !== null,
    { message: 'O perfil precisa de uma coluna de montante ou de colunas débito/crédito', path: ['columns'] }
  );

export const createProfileSchema = z.object({
  name: z.string().trim().min(1, 'O nome do perfil é obrigatório'),
  config: profileConfigSchema,
  created_by: z.enum(['manual', 'agent']).default('manual')
});

export const updateProfileSchema = z.object({
  name: z.string().trim().min(1, 'O nome do perfil é obrigatório').optional(),
  config: profileConfigSchema.optional()
});

// PATCH /imports/:id/rows/:rowId
export const updateImportRowSchema = z
  .object({
    name: z.string().trim().min(1).optional(),
    category_id: z.number().int().positive().nullable().optional(),
    excluded: z.boolean().optional(),
    // Accept the proposed planned-transaction reconciliation for this row
    accept_planned: z.boolean().optional(),
    // Convert the row to a transfer between own accounts
    type: z.literal('transfer').optional(),
    to_account_id: z.number().int().positive().optional()
  })
  .refine(
    (data) => data.type !== 'transfer' || data.to_account_id !== undefined,
    { message: 'Uma transferência precisa da conta de destino', path: ['to_account_id'] }
  );

// POST /imports — multipart with file + fields
export const createImportSchema = z.object({
  accountId: z.coerce.number().int().positive('A conta é obrigatória'),
  profileId: z.coerce.number().int().positive().optional(),
  // Inline profile config (manual editor) when no saved profile is selected
  profileName: z.string().trim().optional(),
  profileConfig: profileConfigSchema.optional()
});
