import { Router } from 'express';
import { QuizController } from '../controllers/quiz.controller.js';
import { authGuard, optionalAuthGuard } from '../middlewares/auth.middleware.js';
import { quotaGuard } from '../middlewares/quota.middleware.js';
import { documentUpload } from '../utils/multer.js';

const router = Router();

// ── Public Routes (with optional auth)
// Lấy chi tiết bài kiểm tra (ẩn đáp án)
router.get('/share/:share_token', QuizController.getSharedQuiz);
// Nộp kết quả (chấm điểm)
router.post('/:quiz_id/attempt', optionalAuthGuard, QuizController.submitAttempt);
// Lấy chi tiết kết quả một lượt làm (Public/Auth)
router.get('/share/:share_token/result/:attempt_id', QuizController.getResult);

// ── Protected Routes
router.use(authGuard);

// Lấy danh sách bài kiểm tra của User 
router.get('/', QuizController.listQuizzes);

// Generate Quiz từ Text
router.post('/generate/text', quotaGuard('quiz'), QuizController.generateFromText);

// Generate Quiz từ file (PDF/Docx)
router.post('/generate/pdf', quotaGuard('quiz'), documentUpload.single('file'), QuizController.generateFromPdf);

// Lưu chính thức đề thi sau khi preview
router.post('/', QuizController.saveQuiz);

// Lấy lịch sử làm bài (Attempts)
router.get('/:quiz_id/attempts', QuizController.getAttempts);

// Quản lý (xoá)
router.delete('/:quiz_id', QuizController.deleteQuiz);

export default router;
