import cron from 'node-cron';
import { db } from '../db/index.js';
import { NotificationService } from '../services/notification.service.js';

/**
 * Worker chạy lúc 08:00 AM mỗi ngày 
 * Thông báo user vào ôn tập Flashcard nếu có thẻ đến hạn
 */
export function initFlashcardWorker() {
  console.log('[Worker] Flashcard Review Due Reminder module initialized (CRON: 0 8 * * *).');

  cron.schedule('0 8 * * *', async () => {
    console.log('[Worker/Flashcard] Bắt đầu quét Flashcard review lúc 08:00...');

    try {
       // Query số lượng thẻ tới hạn của từng user
       const query = `
         SELECT fs.user_id, COUNT(sch.id) as due_count
         FROM flashcard_review_schedules sch
         JOIN flashcards f ON sch.card_id = f.id
         JOIN flashcard_sets fs ON f.set_id = fs.id
         WHERE sch.next_review_at <= NOW()
         GROUP BY fs.user_id
         HAVING COUNT(sch.id) > 0
       `;

       const { rows } = await db.query(query);

       for (const r of rows) {
          const uId = r.user_id;
          const count = Number(r.due_count);
          
          await NotificationService.createNotification(
             uId,
             'flashcard_review_due',
             'Đến giờ ôn tập Flashcard! 🧠',
             `Bạn có \${count} thẻ đang chờ được ôn tập hôm nay. Vào ôn ngay để duy trì trí nhớ nhé!`,
             { due_count: count, action_url: '/learn/flashcard' }
          );
       }
       console.log(`[Worker/Flashcard] Đã gửi thông báo ôn flashcard cho \${rows.length} users.`);

    } catch (err) {
       console.error('[Worker/Flashcard] Lỗi trong lúc quét flashcard due:', err);
    }
  });
}
