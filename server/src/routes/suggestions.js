import { Router } from 'express';
import { suggestionQuerySchema } from '../schemas/suggestion.js';
import { suggestionService } from '../services/suggestionService.js';
import { validateQuery } from '../utils/validation.js';

export const suggestionsRouter = Router();

// GET /api/suggestions/names?categoryId=123&q=con
suggestionsRouter.get('/names', validateQuery(suggestionQuerySchema), (req, res, next) => {
  try {
    const { categoryId, q } = req.query;
    const suggestions = suggestionService.getNameSuggestions(categoryId, q);
    res.json(suggestions);
  } catch (err) {
    next(err);
  }
});
