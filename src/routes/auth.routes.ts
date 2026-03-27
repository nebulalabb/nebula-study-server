import { Router } from 'express';
import { AuthController } from '../controllers/auth.controller.js';
import passport from '../services/passport.js';
import { authGuard } from '../middlewares/auth.middleware.js';

const router = Router();

// [public]
router.post('/register', AuthController.register);
router.get('/verify-email', AuthController.verifyEmail);
router.post('/login', AuthController.login);
router.post('/refresh', AuthController.refresh);
router.post('/forgot-password', AuthController.forgotPassword);
router.post('/reset-password', AuthController.resetPassword);

// Google OAuth
router.get('/google', passport.authenticate('google', { session: false }));
router.get(
  '/google/callback',
  passport.authenticate('google', { session: false, failureRedirect: '/login' }),
  AuthController.googleCallback
);

// [auth]
router.get('/me', authGuard, AuthController.me);
router.post('/logout', authGuard, AuthController.logout);

export default router;
