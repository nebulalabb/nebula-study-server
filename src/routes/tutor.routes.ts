import { Router } from 'express';
import { TutorController } from '../controllers/tutor.controller.js';
import { authGuard } from '../middlewares/auth.middleware.js';

const router = Router();

// Public / Search endpoints
router.get('/', TutorController.searchTutors);
router.get('/:id', TutorController.getTutorProfile);

// Protected endpoints
router.use(authGuard);

router.post('/register', TutorController.registerProfile);
router.post('/:id/book', TutorController.bookSession);
router.post('/booking/:booking_id/review', TutorController.reviewBooking);

router.get('/my/bookings', TutorController.getMyBookings);   // For students
router.get('/my/sessions', TutorController.getMySessions);   // For tutors

export default router;
