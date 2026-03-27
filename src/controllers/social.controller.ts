import { Request, Response, NextFunction } from 'express';
import { db } from '../db/index.js';
import { sendSuccess } from '../utils/response.js';
import { AppError, ERROR_CODES } from '../utils/AppError.js';
import { emitToUser } from '../socket.js';
import { NotificationService } from '../services/notification.service.js';
import cloudinary from '../utils/cloudinary.js';
import { UploadApiResponse, UploadApiErrorResponse } from 'cloudinary';
import streamifier from 'streamifier';

export class SocialController {

  // ── FRIENDSHIPS ────────────────────────────────────────────────────────────

  static async sendFriendRequest(req: Request, res: Response, next: NextFunction) {
    try {
      const { userId: addresseeId } = req.params;
      const requesterId = req.user!.id;

      if (requesterId === addresseeId) {
        throw new AppError('Bạn không thể kết bạn với chính mình', 400, ERROR_CODES.VALIDATION_FAILED);
      }

      // Check if already friends or pending
      const existing = await db.queryOne(
        `SELECT status FROM friendships 
         WHERE (requester_id = $1 AND addressee_id = $2) 
            OR (requester_id = $2 AND addressee_id = $1)`,
        [requesterId, addresseeId]
      );

      if (existing) {
        throw new AppError('Yêu cầu đã tồn tại hoặc đã là bạn bè', 400, ERROR_CODES.VALIDATION_FAILED);
      }

      await db.query(
        'INSERT INTO friendships (requester_id, addressee_id, status) VALUES ($1, $2, $3)',
        [requesterId, addresseeId, 'pending']
      );

      // Emit real-time notification (Toast)
      emitToUser(addresseeId as string, 'friend_request', { 
        requester_id: requesterId,
        message: 'Bạn có lời mời kết bạn mới!' 
      });

      // Create persistent notification
      await NotificationService.createNotification(
        addresseeId as string,
        'friend_request',
        'Lời mời kết bạn mới',
        `Người dùng ${req.user!.full_name} muốn kết bạn với bạn.`,
        { requester_id: requesterId }
      );

      return sendSuccess(res, { message: 'Đã gửi lời mời kết bạn' });
    } catch (err) { next(err); }
  }

  static async acceptFriendRequest(req: Request, res: Response, next: NextFunction) {
    try {
      const { requestId } = req.params;
      const userId = req.user!.id;

      // Fetch the requester_id first to notify them
      const fetchRes = await db.query(
        'SELECT requester_id FROM friendships WHERE id = $1 AND addressee_id = $2',
        [requestId, userId]
      );

      if (fetchRes.rowCount === 0) {
        throw new AppError('Không tìm thấy lời mời kết bạn', 404, ERROR_CODES.RESOURCE_NOT_FOUND);
      }

      const requesterId = fetchRes.rows[0].requester_id;

      await db.query(
        "UPDATE friendships SET status = 'accepted', updated_at = NOW() WHERE id = $1",
        [requestId]
      );

      // Notify the requester (Toast)
      emitToUser(requesterId, 'friend_accepted', {
        addressee_id: userId,
        message: 'Lời mời kết bạn đã được chấp nhận!'
      });

      // Create persistent notification for requester
      await NotificationService.createNotification(
        requesterId,
        'friend_accepted',
        'Lời mời kết bạn được chấp nhận',
        `${req.user!.full_name} đã chấp nhận lời mời kết bạn của bạn. 🎉`,
        { friend_id: userId }
      );

      return sendSuccess(res, { message: 'Đã chấp nhận lời mời kết bạn' });
    } catch (err) { next(err); }
  }

  static async listFriends(req: Request, res: Response, next: NextFunction) {
    try {
      const userId = req.user!.id;
      const { rows } = await db.query(`
        SELECT f.id as friendship_id, f.status, f.created_at,
               u.id as user_id, u.full_name, u.email, u.avatar_url
        FROM friendships f
        JOIN users u ON (f.requester_id = u.id OR f.addressee_id = u.id)
        WHERE (f.requester_id = $1 OR f.addressee_id = $1)
          AND u.id <> $1
          AND f.status = 'accepted'
      `, [userId]);

      return sendSuccess(res, { items: rows });
    } catch (err) { next(err); }
  }

  static async listPendingRequests(req: Request, res: Response, next: NextFunction) {
    try {
      const userId = req.user!.id;
      const { rows } = await db.query(`
        SELECT f.id as request_id, f.created_at,
               u.id as sender_id, u.full_name, u.email, u.avatar_url
        FROM friendships f
        JOIN users u ON f.requester_id = u.id
        WHERE f.addressee_id = $1 AND f.status = 'pending'
      `, [userId]);

      return sendSuccess(res, { items: rows });
    } catch (err) { next(err); }
  }

  // ── MESSAGING ──────────────────────────────────────────────────────────────

  static async sendMessage(req: Request, res: Response, next: NextFunction) {
    try {
      const { recipientId } = req.params;
      const { content, type = 'text', metadata = {} } = req.body;
      const senderId = req.user!.id;

      if (!content && type === 'text') {
        throw new AppError('Nội dung không được để trống', 400, ERROR_CODES.VALIDATION_FAILED);
      }

      // Verify friendship
      const isFriend = await db.queryOne(
        "SELECT id FROM friendships WHERE status = 'accepted' AND ((requester_id = $1 AND addressee_id = $2) OR (requester_id = $2 AND addressee_id = $1))",
        [senderId, recipientId]
      );

      if (!isFriend) {
        throw new AppError('Bạn chỉ có thể nhắn tin cho bạn bè', 403, ERROR_CODES.FORBIDDEN);
      }

      const { rows } = await db.query(
        'INSERT INTO messages (sender_id, recipient_id, content, type, metadata) VALUES ($1, $2, $3, $4, $5) RETURNING *',
        [senderId, recipientId, content || '', type, JSON.stringify(metadata)]
      );

      // Emit real-time message
      emitToUser(recipientId as string, 'new_message', rows[0]);

      return sendSuccess(res, { message_id: rows[0].id, message: rows[0] });
    } catch (err) { next(err); }
  }

  static async uploadMedia(req: Request, res: Response, next: NextFunction) {
    try {
      if (!req.file) {
        throw new AppError('Không có tệp nào được tải lên', 400, ERROR_CODES.VALIDATION_FAILED);
      }

      const senderId = req.user!.id;
      const isVideo = req.file.mimetype.startsWith('video/');

      // Upload to Cloudinary using stream
      const uploadResult = await new Promise<UploadApiResponse>((resolve, reject) => {
        const uploadStream = cloudinary.uploader.upload_stream(
          {
            folder: `nebulalab/chat/${senderId}`,
            resource_type: isVideo ? 'video' : 'image',
          },
          (err: UploadApiErrorResponse | undefined, result: UploadApiResponse | undefined) => {
            if (err || !result) return reject(err || new Error('Upload failed'));
            resolve(result);
          }
        );
        streamifier.createReadStream(req.file!.buffer).pipe(uploadStream);
      });

      return sendSuccess(res, { 
        url: uploadResult.secure_url,
        original_name: req.file.originalname,
        mimetype: req.file.mimetype,
        size: req.file.size,
        metadata: {
            width: uploadResult.width,
            height: uploadResult.height,
            duration: (uploadResult as any).duration,
            format: uploadResult.format
        }
      });
    } catch (err) { next(err); }
  }

  static async getConversation(req: Request, res: Response, next: NextFunction) {
    try {
      const { friendId } = req.params;
      const userId = req.user!.id;
      const { limit = 50, offset = 0 } = req.query;

      const { rows } = await db.query(`
        SELECT id, sender_id, recipient_id, content, type, metadata, is_read, created_at
        FROM messages
        WHERE (sender_id = $1 AND recipient_id = $2)
           OR (sender_id = $2 AND recipient_id = $1)
        ORDER BY created_at DESC
        LIMIT $3 OFFSET $4
      `, [userId, friendId, Number(limit), Number(offset)]);

      // Mark as read
      await db.query(
        'UPDATE messages SET is_read = TRUE WHERE sender_id = $1 AND recipient_id = $2 AND is_read = FALSE',
        [friendId, userId]
      );

      return sendSuccess(res, { items: rows.reverse() });
    } catch (err) { next(err); }
  }

  static async getUnreadMessageCount(req: Request, res: Response, next: NextFunction) {
    try {
      const userId = req.user!.id;
      const { count } = await db.queryOne(
        'SELECT COUNT(*) as count FROM messages WHERE recipient_id = $1 AND is_read = FALSE',
        [userId]
      );
      return sendSuccess(res, { count: parseInt(count) });
    } catch (err) { next(err); }
  }

  static async getPartnerInfo(req: Request, res: Response, next: NextFunction) {
    try {
      const userId = req.user!.id;
      const { partnerId } = req.params;

      const user = await db.queryOne(
        `SELECT u.id as partner_id, u.full_name, u.avatar_url 
         FROM users u
         JOIN friendships f ON (f.requester_id = u.id OR f.addressee_id = u.id)
         WHERE u.id = $1 AND (f.requester_id = $2 OR f.addressee_id = $2) AND f.status = 'accepted'
         LIMIT 1`,
        [partnerId, userId]
      );

      if (!user) {
        throw new AppError('Không tìm thấy thông tin bạn bè', 404, ERROR_CODES.RESOURCE_NOT_FOUND);
      }

      return sendSuccess(res, user);
    } catch (err) { next(err); }
  }

  static async getConversations(req: Request, res: Response, next: NextFunction) {
    try {
      const userId = req.user!.id;
      
      // Get last message from each conversation partner
      const { rows } = await db.query(`
        WITH LastMessages AS (
            SELECT DISTINCT ON (partner_id)
                CASE WHEN sender_id = $1 THEN recipient_id ELSE sender_id END as partner_id,
                content, type, metadata, created_at, is_read, sender_id
            FROM messages
            WHERE sender_id = $1 OR recipient_id = $1
            ORDER BY partner_id, created_at DESC
        )
        SELECT lm.*, u.full_name, u.avatar_url
        FROM LastMessages lm
        JOIN users u ON lm.partner_id = u.id
        ORDER BY lm.created_at DESC
      `, [userId]);

      return sendSuccess(res, { items: rows });
    } catch (err) { next(err); }
  }

  // ── SEARCH ─────────────────────────────────────────────────────────────────

  static async searchUsers(req: Request, res: Response, next: NextFunction) {
    try {
      const { q } = req.query;
      const userId = req.user!.id;

      if (!q) return sendSuccess(res, { items: [] });

      const { rows } = await db.query(`
        SELECT id, full_name, email, avatar_url,
               (SELECT status FROM friendships 
                WHERE (requester_id = $1 AND addressee_id = users.id) 
                   OR (requester_id = users.id AND addressee_id = $1)
                LIMIT 1) as friendship_status
        FROM users
        WHERE (full_name ILIKE $2 OR email ILIKE $2)
          AND id <> $1
          AND deleted_at IS NULL
        LIMIT 10
      `, [userId, `%${q}%`]);

      return sendSuccess(res, { items: rows });
    } catch (err) { next(err); }
  }
}
