import { Router } from 'express';
import { NotificationController } from '../controllers/notification.controller.js';
import { authGuard } from '../middlewares/auth.middleware.js';

const router = Router();

router.use(authGuard);

router.get('/', NotificationController.getNotifications);
router.patch('/read-all', NotificationController.markAllAsRead);
router.patch('/:id/read', NotificationController.markAsRead);

export default router;
