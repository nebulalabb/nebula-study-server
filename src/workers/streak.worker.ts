import cron from 'node-cron';
import { db } from '../db/index.js';
import { NotificationService } from '../services/notification.service.js';
import { EmailService } from '../services/email.service.js';
import logger from '../utils/logger.js';

export function initStreakWorker() {
  // Run every hour to check user's preferred notification_time
  cron.schedule('0 * * * *', async () => {
    try {
      const now = new Date();
      const currentHour = now.getHours().toString().padStart(2, '0') + ':00:00';
      const today = now.toISOString().split('T')[0];

      logger.info(`[Streak Worker] Checking for reminders at hour ${currentHour}...`);
      
      // Query users who:
      // 1. Have notification_time in this hour
      // 2. Haven't performed any microlearning activity today
      const { rows } = await db.query(`
        SELECT u.id, u.email, u.full_name, s.current_streak, s.notification_time
        FROM user_streaks s
        JOIN users u ON s.user_id = u.id
        WHERE (s.notification_time >= $1 AND s.notification_time < $2)
          AND (s.last_activity_date IS NULL OR s.last_activity_date < $3)
          AND u.deleted_at IS NULL
      `, [
        currentHour, 
        (Number(now.getHours()) + 1).toString().padStart(2, '0') + ':00:00',
        today
      ]);

      for (const user of rows) {
        // 1. In-app Notification
        await NotificationService.createNotification(
          user.id,
          'streak_reminder',
          'Nebula Flash: Bài học hôm nay đã sẵn sàng!',
          `Duy trì chuỗi ${user.current_streak} ngày học của bạn chỉ với 5 phút nhé! ✨`,
          { type: 'microlearn' }
        );

        // 2. Email Reminder
        await EmailService.sendEmail({
          to: user.email,
          subject: '[Nebula Study] Đã đến giờ học rồi bạn ơi! 🔥',
          template: 'streak-reminder',
          context: {
            name: user.full_name,
            streak: user.current_streak,
            link: process.env.FRONTEND_URL || 'http://localhost:3000/learn/microlearn'
          }
        });

        logger.info(`[Streak Worker] Reminder sent to ${user.email}`);
      }

    } catch (error) {
      logger.error('[Streak Worker] Fatal error:', error);
    }
  });

  logger.info('[Worker] Streak Reminder worker initialized.');
}
