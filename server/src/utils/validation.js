/**
 * Express middleware helper to validate request body with a Zod schema.
 * Formats errors according to spec: { error: { code: string, message: string, details?: any } }
 */
export function validateBody(schema) {
  return (req, res, next) => {
    const result = schema.safeParse(req.body);
    if (!result.success) {
      return res.status(400).json({
        error: {
          code: 'VALIDATION_ERROR',
          message: result.error.errors[0]?.message || 'Dados inválidos',
          details: result.error.format()
        }
      });
    }
    req.body = result.data;
    next();
  };
}

/**
 * Express middleware helper to validate query params with a Zod schema.
 */
export function validateQuery(schema) {
  return (req, res, next) => {
    const result = schema.safeParse(req.query);
    if (!result.success) {
      return res.status(400).json({
        error: {
          code: 'VALIDATION_ERROR',
          message: result.error.errors[0]?.message || 'Parâmetros de pesquisa inválidos',
          details: result.error.format()
        }
      });
    }
    req.query = result.data;
    next();
  };
}
