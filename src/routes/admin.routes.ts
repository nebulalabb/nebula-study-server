import { Router } from 'express';
import { AdminController } from '../controllers/admin.controller.js';
import { authGuard } from '../middlewares/auth.middleware.js';

// Admin guard: must be authenticated AND role=admin
const adminGuard = (req: any, res: any, next: any) => {
  if (req.user?.role !== 'admin') {
    return res.status(403).json({ success: false, message: 'Admin access required' });
  }
  next();
};

const router = Router();

router.use(authGuard, adminGuard);

router.get('/stats', AdminController.getDashboardStats);

router.get('/users', AdminController.listUsers);
router.patch('/users/:id', AdminController.updateUser);

router.get('/tutors', AdminController.listTutors);
router.patch('/tutors/:id/:action', AdminController.updateTutorStatus);

router.get('/exams', AdminController.listExams);
router.patch('/exams/:id/publish', AdminController.toggleExamPublish);
router.delete('/exams/:id', AdminController.deleteExam);

router.get('/lessons', AdminController.listLessons);
router.post('/lessons', AdminController.createLesson);
router.patch('/lessons/:id', AdminController.updateLesson);
router.delete('/lessons/:id', AdminController.deleteLesson);

// Support Requests
router.get('/support', AdminController.listSupportRequests);
router.patch('/support/:id', AdminController.updateSupportRequest);

export default router;
