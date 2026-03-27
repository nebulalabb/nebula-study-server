import { Request, Response, NextFunction } from 'express';
import { db } from '../db/index.js';
import { sendSuccess } from '../utils/response.js';
import { AppError, ERROR_CODES } from '../utils/AppError.js';
import { NotificationService } from '../services/notification.service.js';

export class SupportController {
  /**
   * Submit a new support request
   */
  static async createRequest(req: Request, res: Response, next: NextFunction) {
    try {
      const { title, category, message } = req.body;
      const userId = req.user!.id;

      if (!title || !category || !message) {
        throw new AppError('Vui lòng điền đầy đủ thông tin', 400, ERROR_CODES.VALIDATION_FAILED);
      }

      const { rows } = await db.query(
        `INSERT INTO support_requests (user_id, title, category, message) 
         VALUES ($1, $2, $3, $4) RETURNING *`,
        [userId, title, category, message]
      );

      // Notify all admins (this is a simple implementation, ideally you'd have a specific notification type or role)
      const admins = await db.query("SELECT id FROM users WHERE role = 'admin'");
      for (const admin of admins.rows) {
        await NotificationService.createNotification(
          admin.id,
          'support_request',
          'Yêu cầu hỗ trợ mới',
          `Người dùng ${req.user!.full_name} đã gửi một yêu cầu hỗ trợ mới: ${title}`,
          { request_id: rows[0].id }
        );
      }

      return sendSuccess(res, { 
        message: 'Yêu cầu hỗ trợ của bạn đã được gửi thành công!',
        request: rows[0] 
      });
    } catch (err) { next(err); }
  }
}
