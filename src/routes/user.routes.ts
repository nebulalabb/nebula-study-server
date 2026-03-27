import { Router } from 'express';
import { UserController } from '../controllers/user.controller.js';
import { authGuard } from '../middlewares/auth.middleware.js';
import { imageUpload } from '../utils/multer.js';

const router = Router();

// All routes require auth
router.use(authGuard);

// 2.1.1 — GET /user/me
router.get('/me', UserController.getMe);

// 2.1.2 — PATCH /user/me
router.patch('/me', UserController.updateMe);

// 2.1.3 — POST /user/me/avatar (multer handles the file)
router.post('/me/avatar', imageUpload.single('file'), UserController.uploadAvatar);

// 2.1.4 — POST /user/me/change-password
router.post('/me/change-password', UserController.changePassword);

// 2.1.5 — GET /user/me/usage
router.get('/me/usage', UserController.getUsage);

router.get('/leaderboard', UserController.getLeaderboard);
router.get('/stats', UserController.getProfileStats);
router.get('/:id', UserController.getPublicProfile);

export default router;
