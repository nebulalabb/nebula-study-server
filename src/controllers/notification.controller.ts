import { Request, Response, NextFunction } from 'express';
import { db } from '../db/index.js';
import { sendSuccess } from '../utils/response.js';
import { AppError, ERROR_CODES } from '../utils/AppError.js';

export class NotificationController {
  
  // ── GET /notification ─────────────────────────────────────────────────────
  static async getNotifications(req: Request, res: Response, next: NextFunction) {
    try {
      const user = req.user!;
      const { unread_only, limit = 20, offset = 0 } = req.query;

      let query = 'SELECT * FROM notifications WHERE user_id = $1';
      const params: any[] = [user.id];
      let paramIndex = 2;

      if (unread_only === 'true') {
         query += ` AND is_read = FALSE`;
      }

      query += ` ORDER BY created_at DESC LIMIT $${paramIndex} OFFSET $${paramIndex+1}`;
      params.push(Number(limit));
      params.push(Number(offset));

      const { rows } = await db.query(query, params);

      // Total unread count
      const countRes = await db.queryOne('SELECT COUNT(*) as c FROM notifications WHERE user_id = $1 AND is_read = FALSE', [user.id]);
      
      return sendSuccess(res, { items: rows, unread_count: Number(countRes?.c || 0) });
    } catch (err) { next(err); }
  }

  // ── PATCH /notification/:id/read ──────────────────────────────────────────
  static async markAsRead(req: Request, res: Response, next: NextFunction) {
    try {
      const user = req.user!;
      const { id } = req.params;

      const { rowCount } = await db.query(`
        UPDATE notifications SET is_read = TRUE, read_at = NOW() 
        WHERE id = $1 AND user_id = $2 AND is_read = FALSE
      `, [id, user.id]);

      if (rowCount === 0) {
        throw new AppError('Không tìm thấy thông báo hoặc đã đọc', 404, ERROR_CODES.RESOURCE_NOT_FOUND);
      }

      return sendSuccess(res, { message: 'Đã đánh dấu đọc thông báo' });
    } catch (err) { next(err); }
  }

  // ── PATCH /notification/read-all ──────────────────────────────────────────
  static async markAllAsRead(req: Request, res: Response, next: NextFunction) {
    try {
      const user = req.user!;
      
      const { rowCount } = await db.query(`
        UPDATE notifications SET is_read = TRUE, read_at = NOW() 
        WHERE user_id = $1 AND is_read = FALSE
      `, [user.id]);

      return sendSuccess(res, { message: `Đã đánh dấu đọc ${rowCount} thông báo` });
    } catch (err) { next(err); }
  }

}
