import { Router } from 'express';
import multer from 'multer';
import {
  createImportSchema,
  createProfileSchema,
  updateProfileSchema,
  updateImportRowSchema
} from '../schemas/import.js';
import { importService } from '../services/importService.js';
import { proposeProfile } from '../services/agentProfile.js';
import { validateBody } from '../utils/validation.js';

export const importsRouter = Router();
export const importProfilesRouter = Router();

// Multipart upload kept fully in memory (5 MB cap — bank CSVs are tiny)
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024, files: 1 }
});

// ---------------------------------------------------------------- profiles

// GET /api/import-profiles
importProfilesRouter.get('/', (req, res, next) => {
  try {
    res.json(importService.listProfiles());
  } catch (err) {
    next(err);
  }
});

// POST /api/import-profiles
importProfilesRouter.post('/', validateBody(createProfileSchema), (req, res, next) => {
  try {
    const profile = importService.createProfile(req.body);
    res.status(201).json(profile);
  } catch (err) {
    if (err.message && err.message.includes('UNIQUE constraint failed')) {
      return res.status(409).json({
        error: { code: 'PROFILE_EXISTS', message: 'Já existe um perfil com este nome' }
      });
    }
    next(err);
  }
});

// PATCH /api/import-profiles/:id
importProfilesRouter.patch('/:id', validateBody(updateProfileSchema), (req, res, next) => {
  try {
    const profile = importService.updateProfile(Number(req.params.id), req.body);
    if (!profile) {
      return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Perfil não encontrado' } });
    }
    res.json(profile);
  } catch (err) {
    if (err.message && err.message.includes('UNIQUE constraint failed')) {
      return res.status(409).json({
        error: { code: 'PROFILE_EXISTS', message: 'Já existe um perfil com este nome' }
      });
    }
    next(err);
  }
});

// ---------------------------------------------------------------- imports

// POST /api/imports — upload CSV (multipart) + accountId + profileId | inline profile
importsRouter.post(
  '/',
  upload.single('file'),
  // multipart fields arrive as strings; parse the inline profile config JSON
  (req, res, next) => {
    if (typeof req.body.profileConfig === 'string') {
      try {
        req.body.profileConfig = JSON.parse(req.body.profileConfig);
      } catch {
        return res.status(400).json({
          error: { code: 'VALIDATION_ERROR', message: 'Configuração de perfil inválida' }
        });
      }
    }
    next();
  },
  validateBody(createImportSchema),
  (req, res, next) => {
    try {
      if (!req.file) {
        return res.status(400).json({
          error: { code: 'FILE_REQUIRED', message: 'É necessário anexar o ficheiro CSV' }
        });
      }
      const { accountId, profileId, profileName, profileConfig } = req.body;
      const batch = importService.createBatch(
        accountId,
        req.file.originalname || 'import.csv',
        { profileId, config: profileConfig, profileName },
        req.file.buffer
      );
      res.status(201).json(batch);
    } catch (err) {
      next(err);
    }
  }
);

// POST /api/imports/propose-profile — agent fallback (opt-in, external call)
importsRouter.post('/propose-profile', upload.single('file'), (req, res, next) => {
  try {
    if (!req.file) {
      return res.status(400).json({
        error: { code: 'FILE_REQUIRED', message: 'É necessário anexar o ficheiro CSV' }
      });
    }
    // Send ONLY the header + a small sample of rows (spec 14.2)
    const text = req.file.buffer.toString('utf8').replace(/^\uFEFF/, '');
    const lines = text.split(/\r?\n/).filter((l) => l.trim() !== '');
    const header = lines[0] || '';
    const sample = lines.slice(1, 11).join('\n');

    proposeProfile({ header, sample })
      .then((proposal) => res.json(proposal))
      .catch(next);
  } catch (err) {
    next(err);
  }
});

// GET /api/imports/:id — batch with rows and counts per match_status
importsRouter.get('/:id', (req, res, next) => {
  try {
    const batch = importService.getBatch(Number(req.params.id));
    if (!batch) {
      return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Importação não encontrada' } });
    }
    res.json(batch);
  } catch (err) {
    next(err);
  }
});

// PATCH /api/imports/:id/rows/:rowId — set category/name, exclude, accept planned, convert to transfer
importsRouter.patch('/:id/rows/:rowId', validateBody(updateImportRowSchema), (req, res, next) => {
  try {
    const batch = importService.updateRow(Number(req.params.id), Number(req.params.rowId), req.body);
    res.json(batch);
  } catch (err) {
    next(err);
  }
});

// POST /api/imports/:id/commit — atomic commit into transactions
importsRouter.post('/:id/commit', (req, res, next) => {
  try {
    const result = importService.commitBatch(Number(req.params.id));
    res.json(result);
  } catch (err) {
    next(err);
  }
});

// DELETE /api/imports/:id — discard draft
importsRouter.delete('/:id', (req, res, next) => {
  try {
    const result = importService.discardBatch(Number(req.params.id));
    res.json(result);
  } catch (err) {
    next(err);
  }
});
