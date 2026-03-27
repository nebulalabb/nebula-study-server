import { Router } from 'express';
import { QuotaController } from '../controllers/quota.controller.js';
import { authGuard } from '../middlewares/auth.middleware.js';

const router = Router();

// 2.2.4 — GET /quota — Xem quota hiện tại [auth]
router.get('/', authGuard, QuotaController.getMyQuota);

export default router;
