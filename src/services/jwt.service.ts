import jwt from 'jsonwebtoken';
import * as dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import { AppError, ERROR_CODES } from '../utils/AppError.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.join(__dirname, '../../../.env') });

const JWT_ACCESS_SECRET = process.env.JWT_ACCESS_SECRET || 'access-secret';
const JWT_REFRESH_SECRET = process.env.JWT_REFRESH_SECRET || 'refresh-secret';

export interface TokenPayload {
  userId: string;
  email: string;
  role: string;
}

/**
 * Service for handling JWT operations
 */
export class JwtService {
  /**
   * Sign a new Access Token (expires in 15m)
   */
  static signAccessToken(payload: TokenPayload): string {
    return jwt.sign(payload, JWT_ACCESS_SECRET, { expiresIn: '15m' });
  }

  /**
   * Sign a new Refresh Token (expires in 7d)
   */
  static signRefreshToken(payload: TokenPayload): string {
    return jwt.sign(payload, JWT_REFRESH_SECRET, { expiresIn: '7d' });
  }

  /**
   * Verify an Access Token
   */
  static verifyAccessToken(token: string): TokenPayload {
    try {
      return jwt.verify(token, JWT_ACCESS_SECRET) as TokenPayload;
    } catch (err: any) {
      if (err.name === 'TokenExpiredError') {
        throw new AppError('Access token expired', 401, ERROR_CODES.AUTH_EXPIRED_TOKEN);
      }
      throw new AppError('Invalid access token', 401, ERROR_CODES.AUTH_INVALID_CREDENTIALS);
    }
  }

  /**
   * Verify a Refresh Token
   */
  static verifyRefreshToken(token: string): TokenPayload {
    try {
      return jwt.verify(token, JWT_REFRESH_SECRET) as TokenPayload;
    } catch (err: any) {
      if (err.name === 'TokenExpiredError') {
        throw new AppError('Refresh token expired', 401, ERROR_CODES.AUTH_EXPIRED_TOKEN);
      }
      throw new AppError('Invalid refresh token', 401, ERROR_CODES.AUTH_INVALID_CREDENTIALS);
    }
  }

  /**
   * Decode a token without verification
   */
  static decodeToken(token: string): TokenPayload | null {
    return jwt.decode(token) as TokenPayload | null;
  }
}
