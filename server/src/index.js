import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getDb } from './db.js';
import { runMigrations } from './migrate.js';
import { accountsRouter } from './routes/accounts.js';
import { categoriesRouter } from './routes/categories.js';
import { transactionsRouter } from './routes/transactions.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export const app = express();

// Standard middleware
app.use(express.json());

// Run forward-only migrations automatically at startup
runMigrations(getDb());

// Liveness check endpoint
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString()
  });
});

// API Routes
app.use('/api/accounts', accountsRouter);
app.use('/api/categories', categoriesRouter);
app.use('/api/transactions', transactionsRouter);

// Serve client dist in production or single-process deployment
const clientDistPath = path.resolve(__dirname, '../../client/dist');
if (fs.existsSync(clientDistPath)) {
  app.use(express.static(clientDistPath));

  // SPA fallback for client routes (excluding /api)
  app.get('*', (req, res, next) => {
    if (req.path.startsWith('/api')) {
      return next();
    }
    res.sendFile(path.join(clientDistPath, 'index.html'));
  });
}

// Global 404 for unmatched /api routes
app.use('/api/*', (req, res) => {
  res.status(404).json({
    error: {
      code: 'NOT_FOUND',
      message: `Endpoint ${req.method} ${req.originalUrl} not found`
    }
  });
});

// Global error handler adhering to spec: { "error": { "code": string, "message": string, "details"?: any } }
app.use((err, req, res, next) => {
  const status = err.status || 500;
  if (status >= 500) {
    console.error('Server error:', err);
  }
  res.status(status).json({
    error: {
      code: err.code || 'INTERNAL_SERVER_ERROR',
      message: err.message || 'Ocorreu um erro inesperado',
      ...(err.details ? { details: err.details } : {})
    }
  });
});

// Start listening if run directly
const isDirectExecution = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(__filename);
if (isDirectExecution) {
  const PORT = Number(process.env.PORT) || 3000;
  const HOST = process.env.HOST || '127.0.0.1';

  app.listen(PORT, HOST, () => {
    console.log(`Server listening on http://${HOST}:${PORT}`);
  });
}
