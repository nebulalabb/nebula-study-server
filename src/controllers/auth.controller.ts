import { Request, Response, NextFunction } from 'express';
import { AuthService } from '../services/auth.service.js';
import { JwtService } from '../services/jwt.service.js';
import { UserService } from '../services/user.service.js';
import { AppError, ERROR_CODES } from '../utils/AppError.js';
import { sendSuccess } from '../utils/response.js';
import { db } from '../db/index.js';
import crypto from 'crypto';
import { addEmailJob } from '../queues/email.queue.js';
import { GamificationService } from '../services/gamification.service.js';

export class AuthController {
  /**
   * POST /auth/register
   */
  static async register(req: Request, res: Response, next: NextFunction) {
    try {
      const { email, password, full_name } = req.body;

      // 1. Basic validation
      if (!email || !password || !full_name) {
        throw new AppError('Missing required fields', 400, ERROR_CODES.VALIDATION_FAILED);
      }

      // 2. Check if email exists
      const existingUser = await UserService.findByEmail(email);
      if (existingUser) {
        throw new AppError('Email already registered', 409, ERROR_CODES.RESOURCE_ALREADY_EXISTS);
      }

      // 3. Hash password
      const passwordHash = await AuthService.hashPassword(password);

      // 4. Create user
      const user = await UserService.createUser({
        email,
        passwordHash,
        fullName: full_name,
      });

      // 5. Create email verification token
      const token = crypto.randomBytes(32).toString('hex');
      const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24 hours

      await db.query(
        'INSERT INTO email_verifications (user_id, token, type, expires_at) VALUES ($1, $2, $3, $4)',
        [user.id, token, 'verify_email', expiresAt]
      );

      // 6. Enqueue email job
      await addEmailJob({
        to: email,
        name: full_name,
        link: `${process.env.FRONTEND_URL || 'http://localhost:3000'}/auth/verify-email?token=${token}`,
        type: 'verify_email',
      });

      // 7. Send success response
      return sendSuccess(res, {
        message: 'Registration successful. Please check your email to verify.',
        user_id: user.id,
      }, 201);

    } catch (err) {
      next(err);
    }
  }

  /**
   * GET /auth/verify-email?token=xxx
   */
  static async verifyEmail(req: Request, res: Response, next: NextFunction) {
    try {
      const { token } = req.query;

      if (!token || typeof token !== 'string') {
        throw new AppError('Invalid or missing token', 400, ERROR_CODES.VALIDATION_FAILED);
      }

      // 1. Find token
      const verification = await db.queryOne(
        'SELECT * FROM email_verifications WHERE token = $1 AND type = $2 AND used_at IS NULL',
        [token, 'verify_email']
      );

      if (!verification) {
        throw new AppError('Token not found or already used', 400, ERROR_CODES.VALIDATION_FAILED);
      }

      // 2. Check expiration
      if (new Date(verification.expires_at) < new Date()) {
        throw new AppError('Token expired', 410, ERROR_CODES.AUTH_EXPIRED_TOKEN);
      }

      // 3. Update user and mark token as used
      const client = await db.getClient();
      try {
        await client.query('BEGIN');
        await client.query('UPDATE users SET email_verified = true WHERE id = $1', [verification.user_id]);
        await client.query('UPDATE email_verifications SET used_at = NOW() WHERE id = $1', [verification.id]);
        await client.query('COMMIT');
      } catch (err) {
        await client.query('ROLLBACK');
        throw err;
      } finally {
        client.release();
      }

      return sendSuccess(res, { message: 'Email verified successfully.' });

    } catch (err) {
      next(err);
    }
  }

  /**
   * POST /auth/login
   */
  static async login(req: Request, res: Response, next: NextFunction) {
    try {
      const { email, password } = req.body;

      // 1. Find user
      const user = await UserService.findByEmail(email);
      if (!user) {
        throw new AppError('Invalid email or password', 401, ERROR_CODES.AUTH_INVALID_CREDENTIALS);
      }

      // 2. Verify password
      const isMatch = await AuthService.comparePassword(password, user.password_hash!);
      if (!isMatch) {
        throw new AppError('Invalid email or password', 401, ERROR_CODES.AUTH_INVALID_CREDENTIALS);
      }

      // 3. Check email verified
      if (!user.email_verified) {
        throw new AppError('Email not verified', 403, ERROR_CODES.AUTH_INVALID_CREDENTIALS);
      }

      // 4. Generate tokens
      const payload = { userId: user.id, email: user.email, role: user.role };
      const accessToken = JwtService.signAccessToken(payload);
      const refreshToken = JwtService.signRefreshToken(payload);

      // 5. Create session
      const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 days
      await db.query(
        'INSERT INTO user_sessions (user_id, refresh_token, expires_at) VALUES ($1, $2, $3)',
        [user.id, refreshToken, expiresAt]
      );

      // 6. Return response
      return sendSuccess(res, {
        access_token: accessToken,
        refresh_token: refreshToken,
        user: {
          id: user.id,
          email: user.email,
          full_name: user.full_name,
          role: user.role,
          plan: user.plan,
          xp: user.xp,
          level: user.level,
          streak: user.streak,
          created_at: user.created_at,
        },
      });

    } catch (err) {
      next(err);
    }
  }

  /**
   * GET /auth/me
   * Return current authenticated user
   */
  static async me(req: Request, res: Response, next: NextFunction) {
    try {
      if (!req.user) {
        throw new AppError('Authentication required', 401, ERROR_CODES.UNAUTHORIZED);
      }

      return sendSuccess(res, {
        user: {
          id: req.user.id,
          email: req.user.email,
          full_name: req.user.full_name,
          role: req.user.role,
          plan: req.user.plan,
          avatar_url: req.user.avatar_url,
          locale: req.user.locale,
          timezone: req.user.timezone,
          xp: req.user.xp,
          level: req.user.level,
          streak: req.user.streak,
          created_at: req.user.created_at,
          ranking: await GamificationService.getGlobalRanking(req.user.id),
        },
      });
    } catch (err) {
      next(err);
    }
  }

  /**
   * POST /auth/refresh
   */
  static async refresh(req: Request, res: Response, next: NextFunction) {
    try {
      const { refresh_token } = req.body;

      if (!refresh_token) {
        throw new AppError('Refresh token required', 401, ERROR_CODES.AUTH_INVALID_CREDENTIALS);
      }

      // 1. Verify token
      const payload = JwtService.verifyRefreshToken(refresh_token);

      // 2. Check session
      const session = await db.queryOne(
        'SELECT * FROM user_sessions WHERE refresh_token = $1 AND revoked_at IS NULL',
        [refresh_token]
      );

      if (!session) {
        throw new AppError('Session not found or revoked', 401, ERROR_CODES.AUTH_INVALID_CREDENTIALS);
      }

      // 3. Rotate tokens
      const newPayload = { userId: payload.userId, email: payload.email, role: payload.role };
      const newAccessToken = JwtService.signAccessToken(newPayload);
      const newRefreshToken = JwtService.signRefreshToken(newPayload);

      // 4. Update session
      await db.query(
        'UPDATE user_sessions SET refresh_token = $1, last_active_at = NOW() WHERE id = $2',
        [newRefreshToken, session.id]
      );

      return sendSuccess(res, {
        access_token: newAccessToken,
        refresh_token: newRefreshToken,
      });

    } catch (err) {
      next(err);
    }
  }

  /**
   * POST /auth/logout
   */
  static async logout(req: Request, res: Response, next: NextFunction) {
    try {
      const { refresh_token } = req.body || {};

      if (refresh_token) {
        await db.query('UPDATE user_sessions SET revoked_at = NOW() WHERE refresh_token = $1', [refresh_token]);
      }

      return sendSuccess(res, { message: 'Logged out successfully.' });

    } catch (err) {
      next(err);
    }
  }

  /**
   * POST /auth/forgot-password
   */
  static async forgotPassword(req: Request, res: Response, next: NextFunction) {
    try {
      const { email } = req.body;

      if (!email) {
        throw new AppError('Email is required', 400, ERROR_CODES.VALIDATION_FAILED);
      }

      // 1. Find user
      const user = await UserService.findByEmail(email);
      if (!user) {
        // [IMPORTANT] Don't reveal if email exists for security (optional, but good practice)
        // However, roadmap says "Gửi link reset password", so we proceed only if user exists.
        return sendSuccess(res, { message: 'If this email exists, a reset link will be sent.' });
      }

      // 2. Create reset token
      const token = crypto.randomBytes(32).toString('hex');
      const expiresAt = new Date(Date.now() + 1 * 60 * 60 * 1000); // 1 hour

      await db.query(
        'INSERT INTO email_verifications (user_id, token, type, expires_at) VALUES ($1, $2, $3, $4)',
        [user.id, token, 'reset_password', expiresAt]
      );

      // 3. Enqueue email job
      await addEmailJob({
        to: email,
        link: `${process.env.FRONTEND_URL || 'http://localhost:3000'}/auth/reset-password?token=${token}`,
        type: 'reset_password',
      });

      return sendSuccess(res, { message: 'If this email exists, a reset link will be sent.' });

    } catch (err) {
      next(err);
    }
  }

  /**
   * POST /auth/reset-password
   */
  static async resetPassword(req: Request, res: Response, next: NextFunction) {
    try {
      const { token, new_password } = req.body;

      if (!token || !new_password) {
        throw new AppError('Token and new password are required', 400, ERROR_CODES.VALIDATION_FAILED);
      }

      // 1. Find token
      const verification = await db.queryOne(
        'SELECT * FROM email_verifications WHERE token = $1 AND type = $2 AND used_at IS NULL',
        [token, 'reset_password']
      );

      if (!verification) {
        throw new AppError('Invalid or expired token', 400, ERROR_CODES.VALIDATION_FAILED);
      }

      // 2. Check expiration
      if (new Date(verification.expires_at) < new Date()) {
        throw new AppError('Token expired', 410, ERROR_CODES.AUTH_EXPIRED_TOKEN);
      }

      // 3. Update password and revoke token
      const passwordHash = await AuthService.hashPassword(new_password);
      const client = await db.getClient();
      try {
        await client.query('BEGIN');
        await client.query('UPDATE users SET password_hash = $1 WHERE id = $2', [passwordHash, verification.user_id]);
        await client.query('UPDATE email_verifications SET used_at = NOW() WHERE id = $1', [verification.id]);
        // Also revoke all sessions for this user for security
        await client.query('UPDATE user_sessions SET revoked_at = NOW() WHERE user_id = $1', [verification.user_id]);
        await client.query('COMMIT');
      } catch (err) {
        await client.query('ROLLBACK');
        throw err;
      } finally {
        client.release();
      }

      return sendSuccess(res, { message: 'Password reset successfully. Please login again.' });

    } catch (err) {
      next(err);
    }
  }

  /**
   * GET /auth/google/callback
   */
  static async googleCallback(req: Request, res: Response, next: NextFunction) {
    try {
      const user = req.user as any;
      if (!user) {
        throw new AppError('Google authentication failed', 401, ERROR_CODES.AUTH_INVALID_CREDENTIALS);
      }

      // 1. Generate tokens
      const payload = { userId: user.id, email: user.email, role: user.role };
      const accessToken = JwtService.signAccessToken(payload);
      const refreshToken = JwtService.signRefreshToken(payload);

      // 2. Create session
      const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
      await db.query(
        'INSERT INTO user_sessions (user_id, refresh_token, expires_at) VALUES ($1, $2, $3)',
        [user.id, refreshToken, expiresAt]
      );

      // 3. Redirect to callback page instead of dashboard
      const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:3000';
      return res.redirect(`${frontendUrl}/callback?access_token=${accessToken}&refresh_token=${refreshToken}`);

    } catch (err) {
      next(err);
    }
  }
}
