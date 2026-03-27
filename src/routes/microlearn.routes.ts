import { Router } from 'express';
import { MicrolearnController } from '../controllers/microlearn.controller.js';
import { authGuard } from '../middlewares/auth.middleware.js';

const router = Router();

// Globally protected
router.use(authGuard);

router.get('/topics', MicrolearnController.listTopics);
router.post('/topics/:topic_id/subscribe', MicrolearnController.subscribeTopic);

router.get('/today', MicrolearnController.getTodayLessons);
router.post('/lesson/:lesson_id/complete', MicrolearnController.completeLesson);

router.get('/streak', MicrolearnController.getStreak);

export default router;
