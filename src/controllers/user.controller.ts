import { Request, Response, NextFunction } from 'express';
import { UserService } from '../services/user.service.js';
import { AuthService } from '../services/auth.service.js';
import { sendSuccess } from '../utils/response.js';
import { AppError, ERROR_CODES } from '../utils/AppError.js';
import cache from '../utils/cache.js';
import { db } from '../db/index.js';
import cloudinary from '../utils/cloudinary.js';
import { UploadApiResponse, UploadApiErrorResponse } from 'cloudinary';
import streamifier from 'streamifier';

// Augment Express Request to include multer's file
declare global {
  namespace Express {
    namespace Multer {
      interface File {}
    }
  }
}

export class UserController {
  /**
   * 2.1.1 GET /user/me — Lấy thông tin user hiện tại
   * Theo API_Spec.md mục 3.1
   */
  static async getMe(req: Request, res: Response, next: NextFunction) {
    try {
      const user = req.user!;
      return sendSuccess(res, {
        id: user.id,
        email: user.email,
        full_name: user.full_name,
        avatar_url: user.avatar_url,
        role: user.role,
        plan: user.plan,
        plan_expires_at: user.plan_expires_at ?? null,
        locale: user.locale,
        timezone: user.timezone,
        xp: user.xp,
        level: user.level,
        streak: user.streak,
        created_at: user.created_at,
      });
    } catch (err) {
      next(err);
    }
  }

  /**
   * 2.1.2 PATCH /user/me — Cập nhật profile
   * Validate fields, UPDATE users, invalidate cache
   * Theo API_Spec.md mục 3.2
   */
  static async updateMe(req: Request, res: Response, next: NextFunction) {
    try {
      const userId = req.user!.id;
      const { full_name, locale, timezone, metadata } = req.body;

      // Validate
      if (full_name !== undefined && (typeof full_name !== 'string' || full_name.length < 2 || full_name.length > 100)) {
        throw new AppError('full_name phải từ 2–100 ký tự', 400, ERROR_CODES.VALIDATION_FAILED);
      }

      const updatedUser = await UserService.updateProfile(userId, { full_name, locale, timezone, metadata });

      // Invalidate user cache
      await cache.del(`user:${userId}`);

      return sendSuccess(res, {
        id: updatedUser.id,
        email: updatedUser.email,
        full_name: updatedUser.full_name,
        avatar_url: updatedUser.avatar_url,
        role: updatedUser.role,
        plan: updatedUser.plan,
        locale: updatedUser.locale,
        timezone: updatedUser.timezone,
        xp: updatedUser.xp,
        level: updatedUser.level,
        streak: updatedUser.streak,
        created_at: updatedUser.created_at,
      });
    } catch (err) {
      next(err);
    }
  }

  /**
   * 2.1.3 POST /user/me/avatar — Upload avatar
   * Multer upload → Cloudinary → UPDATE users avatar_url
   * Theo API_Spec.md mục 3.3
   */
  static async uploadAvatar(req: Request, res: Response, next: NextFunction) {
    try {
      const userId = req.user!.id;

      if (!req.file) {
        throw new AppError('File ảnh là bắt buộc', 400, ERROR_CODES.VALIDATION_FAILED);
      }

      // Validate file type
      const allowedMimes = ['image/jpeg', 'image/png', 'image/webp'];
      if (!allowedMimes.includes(req.file.mimetype)) {
        throw new AppError('Chỉ chấp nhận file JPG, PNG hoặc WebP', 400, ERROR_CODES.VALIDATION_FAILED);
      }

      // Upload to Cloudinary using stream
      const multerFile = (req as Request & { file?: Express.Multer.File }).file;
      const uploadResult = await new Promise<UploadApiResponse>((resolve, reject) => {
        const uploadStream = cloudinary.uploader.upload_stream(
          {
            folder: `nebulalab/avatars/${userId}`,
            transformation: [{ width: 256, height: 256, crop: 'fill', gravity: 'face' }],
            public_id: 'avatar',
            overwrite: true,
          },
          (err: UploadApiErrorResponse | undefined, result: UploadApiResponse | undefined) => {
            if (err || !result) return reject(err || new Error('Upload failed'));
            resolve(result);
          }
        );
        streamifier.createReadStream(multerFile!.buffer).pipe(uploadStream);
      });

      const updatedUser = await UserService.updateAvatar(userId, uploadResult.secure_url);

      // Invalidate cache
      await cache.del(`user:${userId}`);

      return sendSuccess(res, { avatar_url: updatedUser.avatar_url });
    } catch (err) {
      next(err);
    }
  }

  /**
   * 2.1.4 POST /user/me/change-password — Đổi mật khẩu
   * Verify current_password → hash new → UPDATE → revoke all other sessions
   * Theo API_Spec.md mục 3.4
   */
  static async changePassword(req: Request, res: Response, next: NextFunction) {
    try {
      const userId = req.user!.id;
      const { current_password, new_password } = req.body;

      if (!current_password || !new_password) {
        throw new AppError('current_password và new_password là bắt buộc', 400, ERROR_CODES.VALIDATION_FAILED);
      }

      // Must have a password (not OAuth-only)
      const user = await UserService.findById(userId);
      if (!user || !user.password_hash) {
        throw new AppError('Tài khoản này không có mật khẩu (đăng nhập bằng OAuth)', 400, ERROR_CODES.VALIDATION_FAILED);
      }

      // Verify current password
      const isMatch = await AuthService.comparePassword(current_password, user.password_hash);
      if (!isMatch) {
        throw new AppError('Mật khẩu hiện tại không đúng', 401, ERROR_CODES.AUTH_INVALID_CREDENTIALS);
      }

      // Hash and update
      const newHash = await AuthService.hashPassword(new_password);
      await UserService.updatePassword(userId, newHash);

      // Revoke all other sessions
      const currentRefreshToken = req.body.refresh_token;
      await UserService.revokeAllOtherSessions(userId, currentRefreshToken);

      // Invalidate cache
      await cache.del(`user:${userId}`);

      return sendSuccess(res, { message: 'Mật khẩu đã được cập nhật.' });
    } catch (err) {
      next(err);
    }
  }

  /**
   * 2.1.5 GET /user/me/usage — Lịch sử sử dụng
   * Query usage_logs, group by module
   * Theo API_Spec.md mục 3.5
   */
  static async getUsage(req: Request, res: Response, next: NextFunction) {
    try {
      const userId = req.user!.id;
      const { module: moduleFilter, from, to } = req.query;

      // Build date filters
      const fromDate = from ? new Date(from as string) : new Date(new Date().setDate(1)); // start of month
      const toDate = to ? new Date(to as string) : new Date();

      // Query usage summary grouped by module
      const summaryRows = await db.query<{ module: string; today_count: string; month_count: string }>(
        `SELECT module,
          COUNT(*) FILTER (WHERE created_at >= CURRENT_DATE) AS today_count,
          COUNT(*) FILTER (WHERE created_at >= DATE_TRUNC('month', NOW())) AS month_count
         FROM usage_logs
         WHERE user_id = $1
           AND ($2::text IS NULL OR module = $2)
         GROUP BY module`,
        [userId, moduleFilter || null]
      );

      const summary: Record<string, { today: number; this_month: number }> = {};
      for (const row of summaryRows.rows) {
        summary[row.module] = {
          today: parseInt(row.today_count, 10),
          this_month: parseInt(row.month_count, 10),
        };
      }

      // Query detailed logs
      const logsRows = await db.query(
        `SELECT id, module, action, tokens_used, metadata, created_at
         FROM usage_logs
         WHERE user_id = $1
           AND created_at BETWEEN $2 AND $3
           AND ($4::text IS NULL OR module = $4)
         ORDER BY created_at DESC
         LIMIT 100`,
        [userId, fromDate, toDate, moduleFilter || null]
      );

      return sendSuccess(res, {
        summary,
        logs: logsRows.rows,
      });
    } catch (err) {
      next(err);
    }
  }

  /**
   * 2.1.6 GET /user/leaderboard — Bảng xếp hạng
   * Lấy top 100 users theo XP
   */
  static async getLeaderboard(req: Request, res: Response, next: NextFunction) {
    try {
      const users = await UserService.getLeaderboard(100);
      return sendSuccess(res, { items: users });
    } catch (err) {
      next(err);
    }
  }

  /**
   * 2.1.7 GET /user/stats — Lấy thống kê chi tiết (Số câu, Accuracy, Huy hiệu)
   */
  static async getProfileStats(req: Request, res: Response, next: NextFunction) {
    try {
      const userId = req.user!.id;
      const stats = await UserService.getStudentStats(userId);
      return sendSuccess(res, stats);
    } catch (err) {
      next(err);
    }
  }

  /**
   * 2.1.8 GET /user/:id — Lấy profile công khai của người khác
   */
  static async getPublicProfile(req: Request, res: Response, next: NextFunction) {
    try {
      const id = req.params.id as string;
      const user = await UserService.findById(id);

      if (!user) {
        throw new AppError('Không tìm thấy người dùng', 404, ERROR_CODES.RESOURCE_NOT_FOUND);
      }

      const stats = await UserService.getStudentStats(id);
      
      // Get friendship status if logged in
      const currentUserId = req.user!.id;
      const friendship = await db.queryOne(
        `SELECT status, requester_id FROM friendships 
         WHERE (requester_id = $1 AND addressee_id = $2) 
            OR (requester_id = $2 AND addressee_id = $1)`,
        [currentUserId, id]
      );

      return sendSuccess(res, {
        profile: {
          id: user.id,
          full_name: user.full_name,
          avatar_url: user.avatar_url,
          level: user.level,
          xp: user.xp,
          streak: user.streak,
          created_at: user.created_at,
          role: user.role,
          friendship_status: friendship?.status || null,
          is_friend_requester: friendship?.requester_id === currentUserId
        },
        stats
      });
    } catch (err) {
      next(err);
    }
  }
}
