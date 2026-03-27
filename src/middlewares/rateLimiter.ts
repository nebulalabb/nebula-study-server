import rateLimit from 'express-rate-limit';
import { sendError } from '../utils/response';
import { ERROR_CODES } from '../utils/AppError';

/**
 * Global Rate Limiter: 100 requests per minute
 */
export const globalLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 100,
  message: {
    success: false,
    error: {
      code: ERROR_CODES.QUOTA_EXCEEDED,
      message: 'Too many requests, please try again later.',
    },
  },
  handler: (req, res, next, options) => {
    sendError(res, ERROR_CODES.QUOTA_EXCEEDED, options.message.error.message, 429);
  },
  standardHeaders: true,
  legacyHeaders: false,
});

/**
 * AI API Limiter: 20 requests per minute
 */
export const aiLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 20,
  message: {
    success: false,
    error: {
      code: ERROR_CODES.QUOTA_LIMIT_DAILY,
      message: 'AI quota limit reached for this window.',
    },
  },
  handler: (req, res, next, options) => {
    sendError(res, ERROR_CODES.QUOTA_LIMIT_DAILY, options.message.error.message, 429);
  },
  standardHeaders: true,
  legacyHeaders: false,
});
