import { z } from 'zod';

/**
 * Agent fallback for unknown CSV formats (AGENT.md section 14.2, opt-in).
 * Sends ONLY the header line plus a small sample of rows to the Anthropic API
 * and asks for an import profile in a strict JSON schema (validated with zod).
 * The agent proposes parsing configuration only — never categories.
 */

export const agentProfileSchema = z.object({
  encoding: z.enum(['utf8', 'windows-1252']),
  delimiter: z.string().min(1).max(1),
  skip_rows: z.number().int().min(0).max(50),
  has_header_row: z.boolean(),
  date_format: z.enum(['DD/MM/YYYY', 'DD-MM-YYYY', 'YYYY-MM-DD', 'DD/MM/YY']),
  decimal_separator: z.enum([',', '.']),
  thousand_separator: z.enum(['.', ',', '', ' ']),
  columns: z
    .object({
      date: z.number().int().min(0).max(30),
      description: z.number().int().min(0).max(30),
      amount: z.number().int().min(0).max(30).nullable(),
      debit: z.number().int().min(0).max(30).nullable(),
      credit: z.number().int().min(0).max(30).nullable()
    })
    .refine(
      (c) =>
        (c.amount !== null && c.amount !== undefined) ||
        (c.debit !== null && c.debit !== undefined && c.credit !== null && c.credit !== undefined),
      { message: 'O perfil precisa de uma coluna de montante ou de colunas débito/crédito' }
    ),
  cleanup_rules: z
    .array(
      z.discriminatedUnion('type', [
        z.object({ type: z.literal('strip_prefix'), value: z.string().min(1) }),
        z.object({ type: z.literal('strip_suffix'), value: z.string().min(1) }),
        z.object({ type: z.literal('replace'), value: z.string().min(1), replacement: z.string() }),
        z.object({ type: z.literal('trim') })
      ])
    )
    .max(10)
});

const TOOL_NAME = 'propose_import_profile';

const SYSTEM_PROMPT = `You propose CSV import profiles for a personal finance app. You receive the header line and a small sample of rows from a bank statement export. Return parsing configuration ONLY. Never invent column meanings beyond what the sample shows. Respond via the ${TOOL_NAME} tool with the exact JSON schema provided.`;

/**
 * Calls the Anthropic API with a tool-forced strict JSON schema response.
 * @param {{ header: string, sample: string }} payload
 * @param {object} [options]
 * @param {string} [options.apiKey] defaults to process.env.ANTHROPIC_API_KEY
 * @param {typeof fetch} [options.fetchFn] injectable for tests
 * @returns {{ config: object, model: string }}
 */
export async function proposeProfile({ header, sample }, { apiKey, fetchFn } = {}) {
  const key = apiKey || process.env.ANTHROPIC_API_KEY;
  if (!key) {
    const error = new Error('A proposta automática de perfil requer ANTHROPIC_API_KEY em .env');
    error.code = 'AGENT_UNAVAILABLE';
    error.status = 400;
    throw error;
  }
  const doFetch = fetchFn || fetch;

  const response = await doFetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': key,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json'
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-5',
      max_tokens: 1024,
      system: SYSTEM_PROMPT,
      messages: [
        {
          role: 'user',
          content: `CSV header line:\n${header}\n\nSample rows:\n${sample}\n\nPropose an import profile for this format.`
        }
      ],
      tools: [
        {
          name: TOOL_NAME,
          description: 'Propose a CSV import profile',
          input_schema: {
            type: 'object',
            properties: {
              encoding: { type: 'string', enum: ['utf8', 'windows-1252'] },
              delimiter: { type: 'string', minLength: 1, maxLength: 1 },
              skip_rows: { type: 'integer', minimum: 0, maximum: 50 },
              has_header_row: { type: 'boolean' },
              date_format: { type: 'string', enum: ['DD/MM/YYYY', 'DD-MM-YYYY', 'YYYY-MM-DD', 'DD/MM/YY'] },
              decimal_separator: { type: 'string', enum: [',', '.'] },
              thousand_separator: { type: 'string', enum: ['.', ',', ''] },
              columns: {
                type: 'object',
                properties: {
                  date: { type: 'integer', minimum: 0 },
                  description: { type: 'integer', minimum: 0 },
                  amount: { type: ['integer', 'null'], minimum: 0 },
                  debit: { type: ['integer', 'null'], minimum: 0 },
                  credit: { type: ['integer', 'null'], minimum: 0 }
                },
                required: ['date', 'description', 'amount', 'debit', 'credit']
              },
              cleanup_rules: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: {
                    type: { type: 'string', enum: ['strip_prefix', 'strip_suffix', 'replace', 'trim'] },
                    value: { type: 'string' },
                    replacement: { type: 'string' }
                  },
                  required: ['type']
                }
              }
            },
            required: [
              'encoding',
              'delimiter',
              'skip_rows',
              'has_header_row',
              'date_format',
              'decimal_separator',
              'thousand_separator',
              'columns',
              'cleanup_rules'
            ]
          }
        }
      ],
      tool_choice: { type: 'tool', name: TOOL_NAME }
    })
  });

  if (!response.ok) {
    const error = new Error(`O serviço de proposta de perfil respondeu com o código ${response.status}`);
    error.code = 'AGENT_ERROR';
    error.status = 502;
    throw error;
  }

  const body = await response.json();
  const toolUse = (body.content || []).find((block) => block.type === 'tool_use' && block.name === TOOL_NAME);
  if (!toolUse) {
    const error = new Error('Resposta inesperada do serviço de proposta de perfil');
    error.code = 'AGENT_MALFORMED';
    error.status = 502;
    throw error;
  }

  // Strict validation — malformed proposals are rejected, never half-applied
  const parsed = agentProfileSchema.safeParse(toolUse.input);
  if (!parsed.success) {
    const error = new Error('A proposta de perfil não passou a validação do esquema');
    error.code = 'AGENT_MALFORMED';
    error.status = 502;
    error.details = parsed.error.format();
    throw error;
  }

  return { config: parsed.data, model: body.model || 'unknown' };
}
