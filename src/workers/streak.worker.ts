import cron from 'node-cron';
import { db } from '../db/index.js';

export function initStreakWorker() {
  // Run every day at 08:00 AM
  cron.schedule('0 8 * * *', async () => {
    try {
      console.log('[Streak Worker] Sending daily learning reminders...');
      
      // Get users with active streak > 0 
      const { rows } = await db.query(`
        SELECT u.email, u.full_name, s.current_streak
        FROM user_streaks s
        JOIN users u ON s.user_id = u.id
        WHERE s.current_streak > 0
      `);

      for (const user of rows) {
        // In real app, push email or mobile notification here
        console.log(`[Streak Worker] Reminder sent to \${user.email} (Streak: \${user.current_streak} days)`);
      }

    } catch (error) {
      console.error('[Streak Worker] Fatal error:', error);
    }
  });

  console.log('[Worker] Streak Reminder worker initialized.');
}
