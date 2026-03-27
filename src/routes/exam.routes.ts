import { Router } from 'express';
import { ExamController } from '../controllers/exam.controller.js';
import { authGuard } from '../middlewares/auth.middleware.js';
import { quotaGuard } from '../middlewares/quota.middleware.js';

const router = Router();

// Require auth for exams globally since they store attempts attached to users
router.use(authGuard);

// ── GET Lists
router.get('/', ExamController.listExams);
router.get('/history', ExamController.getHistory);
router.get('/analytics', ExamController.getAnalytics);
router.get('/:id', ExamController.getExam);

// ── AI Generation (Requires Quota tracking)
router.post('/generate', quotaGuard('exam'), ExamController.generateExam);

// ── Attempt & Scoring flow
router.post('/:exam_id/attempt/start', quotaGuard('exam'), ExamController.startAttempt);
router.post('/attempt/:attempt_id/submit', ExamController.submitAttempt);
router.get('/attempt/:attempt_id/result', ExamController.getAttemptResult);

export default router;
