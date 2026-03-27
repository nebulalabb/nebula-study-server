import { Request, Response, NextFunction } from 'express';
import { JwtService } from '../services/jwt.service.js';
import { UserService, User as AppUser } from '../services/user.service.js';
import { AppError, ERROR_CODES } from '../utils/AppError.js';
import cache from '../utils/cache.js';
import { db } from '../db/index.js';

// Extend Express User type to include our AppUser properties
declare global {
  namespace Express {
    interface User extends AppUser {}
  }
}

/**
 * Middleware to protect routes and verify JWT access token
 * [auth] guard
 */
export const authGuard = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      throw new AppError('Authentication required', 401, ERROR_CODES.UNAUTHORIZED);
    }

    const token = authHeader.split(' ')[1];
    if (!token) throw new AppError('Authentication required', 401, ERROR_CODES.UNAUTHORIZED);
    
    // 1. Verify JWT
    const payload = JwtService.verifyAccessToken(token);

    if (!payload.email || !payload.userId) {
      throw new AppError('Invalid token payload', 401, ERROR_CODES.AUTH_INVALID_CREDENTIALS);
    }

    // 2. Check Cache
    const cacheKey = `user:${payload.userId}`;
    let user = await cache.get<AppUser>(cacheKey);

    // 3. Query DB if cache miss
    if (!user) {
      user = await UserService.findByEmail(payload.email!);
      if (!user) {
        throw new AppError('User not found', 404, ERROR_CODES.RESOURCE_NOT_FOUND);
      }
      
      // Cache user for 15 minutes (900 seconds)
      await cache.set(cacheKey, user, 900);
    }

    // 4. Check if user is active/verified
    if (!user.email_verified) {
      throw new AppError('Email not verified', 403, ERROR_CODES.AUTH_INVALID_CREDENTIALS);
    }

    // Attach user to request
    req.user = user;
    next();

  } catch (err) {
    next(err);
  }
};

/**
 * Middleware for routes that can be accessed by both guests and authenticated users.
 * If token is present and valid, attaches user. If not, proceeds anyway.
 */
export const optionalAuthGuard = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return next();
    }

    const token = authHeader.split(' ')[1];
    if (!token) return next();
    
    // We try to verify, but suppress throws
    let payload;
    try {
      payload = JwtService.verifyAccessToken(token);
    } catch {
      return next(); // invalid token, treat as guest
    }

    if (!payload.email || !payload.userId) {
      return next();
    }

    const cacheKey = `user:${payload.userId}`;
    let user = await cache.get<AppUser>(cacheKey);

    if (!user) {
      user = await UserService.findByEmail(payload.email!);
      if (user) {
        await cache.set(cacheKey, user, 900);
      }
    }

    if (user && user.email_verified) {
      req.user = user;
    }

    next();
  } catch (err) {
    next(); // never block on optional auth
  }
};

/**
 * Middleware to check if user has premium/enterprise plan
 * [premium] guard
 */
export const premiumGuard = (req: Request, res: Response, next: NextFunction) => {
  if (!req.user) {
    return next(new AppError('Authentication required', 401, ERROR_CODES.UNAUTHORIZED));
  }

  if (req.user.plan === 'free') {
    return next(new AppError('Premium subscription required', 403, ERROR_CODES.AUTH_INSUFFICIENT_PERMISSIONS));
  }

  next();
};

/**
 * Middleware to check if user has admin role
 * [admin] guard
 */
export const adminGuard = (req: Request, res: Response, next: NextFunction) => {
  if (!req.user) {
    return next(new AppError('Authentication required', 401, ERROR_CODES.UNAUTHORIZED));
  }

  if (req.user.role !== 'admin') {
    return next(new AppError('Admin access required', 403, ERROR_CODES.FORBIDDEN));
  }

  next();
};

/**
 * Middleware to check if user is a verified tutor
 * [tutor] guard
 */
export const tutorGuard = async (req: Request, res: Response, next: NextFunction) => {
  if (!req.user) {
    return next(new AppError('Authentication required', 401, ERROR_CODES.UNAUTHORIZED));
  }

  if (req.user.role !== 'tutor') {
    return next(new AppError('Tutor access required', 403, ERROR_CODES.FORBIDDEN));
  }

  // Check if tutor profile is APPROVED in tutor_profiles table
  const tutorProfile = await db.queryOne(
    'SELECT status FROM tutor_profiles WHERE user_id = $1',
    [req.user.id]
  );
  
  if (!tutorProfile || tutorProfile.status !== 'approved') {
    return next(new AppError('Tutor profile not approved', 403, ERROR_CODES.FORBIDDEN));
  }
  
  next();
};
