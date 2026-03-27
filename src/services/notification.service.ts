import { db } from '../db/index.js';
import { emitToUser } from '../socket.js';

export type NotificationType = 'flashcard_review_due' | 'streak_reminder' | 'booking_confirmed' | 'booking_reminder' | 'payment_success' | 'payment_failed' | 'system' | 'friend_request' | 'friend_accepted' | 'tutor_approved' | 'support_request' | 'support_update';

export class NotificationService {
  /**
   * Tạo notifications và lưu vào Database
   */
  static async createNotification(
    userId: string,
    type: NotificationType,
    title: string,
    message: string,
    data: any = {}
  ) {
    try {
      const { rows } = await db.query(`
        INSERT INTO notifications (user_id, type, title, body, data)
        VALUES ($1, $2, $3, $4, $5)
      `, [userId, type, title, message, JSON.stringify(data)]);
      
      // Emit socket.io realtime event
      emitToUser(userId, 'notification', rows[0]);

      return rows[0];
    } catch (err) {
      console.error('[NotificationService] Failed to create notification:', err);
      throw err;
    }
  }

  /**
   * Broadcast tới group user (VD: Toàn bộ admin)
   */
  static async broadcastNotification(
    userIds: string[],
    type: NotificationType,
    title: string,
    body: string,
    data: any = {}
  ) {
    // Dùng batch insert hoặc loop
    const promises = userIds.map(uid => this.createNotification(uid, type, title, body, data));
    await Promise.allSettled(promises);
  }
}
