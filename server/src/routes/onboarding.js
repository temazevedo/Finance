import { Router } from 'express';
import { completeOnboardingSchema, saveStepSchema } from '../schemas/onboarding.js';
import { onboardingService } from '../services/onboardingService.js';
import { validateBody } from '../utils/validation.js';

export const onboardingRouter = Router();

// GET /api/onboarding/state - get status and current step
onboardingRouter.get('/state', (req, res, next) => {
  try {
    const state = onboardingService.getState();
    res.json(state);
  } catch (err) {
    next(err);
  }
});

// PUT /api/onboarding/step - persist progress
onboardingRouter.put('/step', validateBody(saveStepSchema), (req, res, next) => {
  try {
    const state = onboardingService.saveStep(req.body.step, req.body.data);
    res.json(state);
  } catch (err) {
    next(err);
  }
});

// POST /api/onboarding/complete - finalize onboarding
onboardingRouter.post('/complete', validateBody(completeOnboardingSchema), (req, res, next) => {
  try {
    const result = onboardingService.completeOnboarding(req.body);
    res.json(result);
  } catch (err) {
    next(err);
  }
});
