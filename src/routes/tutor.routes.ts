import { Router } from 'express';
import { TutorController } from '../controllers/tutor.controller.js';
import { authGuard } from '../middlewares/auth.middleware.js';

const router = Router();

// Specific routes first
router.get('/my-profile', authGuard, TutorController.getMyProfile);

// Public / Search endpoints
router.get('/', TutorController.searchTutors);
router.get('/:id', TutorController.getTutorProfile);
router.get('/:id/availability', TutorController.getDayAvailability);

// Protected endpoints
router.use(authGuard);

router.post('/register', TutorController.registerProfile);
router.patch('/profile', TutorController.updateProfile);
router.patch('/availability', TutorController.updateAvailability);
router.patch('/profile/toggle-availability', TutorController.toggleAvailability);

router.post('/:id/book', TutorController.bookSession);
router.patch('/bookings/:id/status', TutorController.updateBookingStatus);
router.post('/booking/:booking_id/review', TutorController.reviewBooking);

router.get('/my/bookings', TutorController.getMyBookings);   // For students
router.get('/my/sessions', TutorController.getMySessions);   // For tutors

export default router;
