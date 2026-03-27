import { Router } from 'express';
import { SolverController } from '../controllers/solver.controller.js';
import { authGuard } from '../middlewares/auth.middleware.js';
import { quotaGuard } from '../middlewares/quota.middleware.js';
import { imageUpload } from '../utils/multer.js';

const router = Router();

// All solver routes require auth
router.use(authGuard);

// 3.1.4 — POST /solver/solve (text)
router.post('/solve', quotaGuard('solver'), SolverController.solveText);

// 3.1.5 — POST /solver/solve/image (image upload)
router.post('/solve/image', quotaGuard('solver'), imageUpload.single('image'), SolverController.solveImage);

// 3.1.6 — GET /solver/history
router.get('/history', SolverController.getHistory);

// 3.1.7 — DELETE /solver/history/:id
router.delete('/history/:id', SolverController.deleteHistory);

export default router;
