/**
 * Custom application error class for NebulaLab API
 */
export class AppError extends Error {
  public readonly statusCode: number;
  public readonly code: string;
  public readonly isOperational: boolean;

  constructor(message: string, statusCode: number, code: string) {
    super(message);
    this.statusCode = statusCode;
    this.code = code;
    this.isOperational = true;

    Error.captureStackTrace(this, this.constructor);
  }
}

/**
 * Common Error Codes from API_Spec.md
 */
export const ERROR_CODES = {
  // Auth
  AUTH_INVALID_CREDENTIALS: 'auth/invalid-credentials',
  AUTH_EXPIRED_TOKEN: 'auth/expired-token',
  AUTH_INSUFFICIENT_PERMISSIONS: 'auth/insufficient-permissions',
  UNAUTHORIZED: 'auth/unauthorized',
  FORBIDDEN: 'auth/forbidden',

  // Quota
  QUOTA_EXCEEDED: 'quota/exceeded',
  QUOTA_LIMIT_DAILY: 'quota/limit-daily',

  // Validation
  VALIDATION_FAILED: 'validation/failed',

  // Resource
  RESOURCE_NOT_FOUND: 'resource/not-found',
  RESOURCE_ALREADY_EXISTS: 'resource/already-exists',

  // Internal
  INTERNAL_SERVER_ERROR: 'server/internal-error',
  SERVICE_UNAVAILABLE: 'server/service-unavailable',
};
