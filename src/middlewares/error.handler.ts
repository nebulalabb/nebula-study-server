import { Request, Response, NextFunction } from 'express';
import { AppError, ERROR_CODES } from '../utils/AppError.js';
import { sendError } from '../utils/response.js';
import logger from '../utils/logger.js';

/**
 * Global Error Handling Middleware
 */
export const errorHandler = (err: any, req: Request, res: Response, next: NextFunction) => {
  logger.error(`${err.message} - ${req.method} ${req.originalUrl}`);

  if (err instanceof AppError) {
    return sendError(res, err.code, err.message, err.statusCode);
  }

  // Handle specialized errors (e.g. Postgres, validation, etc.)
  if (err.name === 'ValidationError') {
    return sendError(res, ERROR_CODES.VALIDATION_FAILED, err.message, 400);
  }

  if (err.code === '23505') { // Postgres unique_violation
    return sendError(res, ERROR_CODES.RESOURCE_ALREADY_EXISTS, 'Resource already exists', 409);
  }

  // Fallback for unexpected errors
  const isDev = process.env.NODE_ENV === 'development';
  return sendError(
    res,
    ERROR_CODES.INTERNAL_SERVER_ERROR,
    isDev ? err.message : 'Internal Server Error',
    500,
    isDev ? err.stack : undefined
  );
};
