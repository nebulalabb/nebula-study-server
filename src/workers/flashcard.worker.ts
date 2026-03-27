import cron from 'node-cron';
import { db } from '../db/index.js';
import { NotificationService } from '../services/notification.service.js';
import { EmailService } from '../services/email.service.js';

/**
 * Worker chạy lúc 08:00 AM mỗi ngày 
 * Thông báo user vào ôn tập Flashcard nếu có thẻ đến hạn
 */
export function initFlashcardWorker() {
  console.log('[Worker] Flashcard Review Due Reminder module initialized (CRON: 0 8 * * *).');

  cron.schedule('0 8 * * *', async () => {
    console.log('[Worker/Flashcard] Bắt đầu quét Flashcard review lúc 08:00...');

    try {
       // Query số lượng thẻ tới hạn của từng user + thông tin user
       const query = `
         SELECT u.id, u.email, u.full_name, COUNT(sch.id) as due_count
         FROM review_schedules sch
         JOIN users u ON sch.user_id = u.id
         WHERE sch.next_review_at <= NOW()
         GROUP BY u.id, u.email, u.full_name
         HAVING COUNT(sch.id) > 0
       `;

       const { rows } = await db.query(query);

       for (const r of rows) {
          const uId = r.id;
          const count = Number(r.due_count);
          const email = r.email;
          const name = r.full_name || 'bạn';
          
          // 1. Gửi thông báo trong App (Web)
          await NotificationService.createNotification(
             uId,
             'flashcard_review_due',
             'Đến giờ ôn tập Flashcard! 🧠',
             `Bạn có ${count} thẻ đang chờ được ôn tập hôm nay. Vào ôn ngay để duy trì trí nhớ nhé!`,
             { due_count: count, action_url: '/learn/flashcard/review' }
          );

          // 2. Gửi Email nhắc nhở
          if (email) {
            await EmailService.sendEmail({
              to: email,
              subject: `[NebulaStudy] Bạn có ${count} flashcard cần ôn tập hôm nay! 🧠`,
              template: 'flashcard-reminder',
              context: {
                name,
                due_count: count,
                action_url: 'http://localhost:3000/learn/flashcard/review' // TODO: Sử dụng biến env cho domain
              }
            }).catch(err => console.error(`[Worker/Flashcard] Lỗi gửi email cho ${email}:`, err));
          }
       }
       console.log(`[Worker/Flashcard] Đã gửi thông báo ôn flashcard cho ${rows.length} users.`);

    } catch (err) {
       console.error('[Worker/Flashcard] Lỗi trong lúc quét flashcard due:', err);
    }
  });
}
