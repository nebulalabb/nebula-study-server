import { Router } from 'express';
import { SupportController } from '../controllers/support.controller.js';
import { authGuard } from '../middlewares/auth.middleware.js';

const router = Router();

router.use(authGuard);

router.post('/request', SupportController.createRequest);

export default router;
