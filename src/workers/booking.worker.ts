import cron from 'node-cron';
import { db } from '../db/index.js';
import { NotificationService } from '../services/notification.service.js';

/**
 * Worker xử lý các tác vụ liên quan đến Booking:
 * 1. Tự động chuyển booking từ 'confirmed' sang 'completed' sau khi thời gian buổi học kết thúc.
 * 2. Gửi thông báo nhắc nhở đánh giá cho học sinh.
 */
export function initBookingWorker() {
  // Chạy mỗi 30 phút
  cron.schedule('*/30 * * * *', async () => {
    try {
      console.log('[Booking Worker] Checking for completed sessions...');

      const client = await db.getClient();
      try {
        await client.query('BEGIN');

        // 1. Tìm các booking confirmed đã kết thúc (session_date + end_time < NOW())
        // session_date là DATE, end_time là TIME. 
        // Trong Postgres: session_date + end_time tạo ra TIMESTAMPTZ
        const completedRes = await client.query(`
          UPDATE bookings
          SET status = 'completed', updated_at = NOW()
          WHERE status = 'confirmed' 
          AND (session_date + end_time) <= NOW()
          RETURNING id, student_id, tutor_id
        `);

        if (completedRes.rowCount && completedRes.rowCount > 0) {
          console.log(`[Booking Worker] Marked ${completedRes.rowCount} bookings as completed.`);

          // 2. Gửi thông báo nhắc đánh giá cho học sinh
          for (const b of completedRes.rows) {
            await NotificationService.createNotification(
              b.student_id,
              'booking_reminder',
              'Đánh giá buổi học',
              'Buổi học của bạn đã kết thúc. Hãy để lại đánh giá cho gia sư nhé!',
              { booking_id: b.id }
            );
          }
        }

        await client.query('COMMIT');
      } catch (err) {
        await client.query('ROLLBACK');
        console.error('[Booking Worker] Error:', err);
      } finally {
        client.release();
      }
    } catch (error) {
      console.error('[Booking Worker] Fatal error:', error);
    }
  });

  console.log('[Worker] Booking management worker initialized (every 30m).');
}
