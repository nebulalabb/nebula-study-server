import cron from 'node-cron';
import { db } from '../db/index.js';

export function initBillingWorker() {
  // Run every day at 00:00 (Midnight)
  cron.schedule('0 0 * * *', async () => {
    try {
      console.log('[Billing Worker] Checking for expired subscriptions...');
      
      const client = await db.getClient();
      try {
        await client.query('BEGIN');
        
        // 1. Mark subscriptions as expired
        await client.query(`
          UPDATE subscriptions 
          SET status = 'expired', updated_at = NOW()
          WHERE status = 'active' AND expires_at < NOW()
        `);

        // 2. Downgrade users who don't have any other active subscriptions
        // Note: The above query expires them, so if a user has no 'active' subscriptions left, downgrade them.
        const res = await client.query(`
          UPDATE users u
          SET plan = 'free', plan_expires_at = NULL
          WHERE u.plan = 'premium'
          AND NOT EXISTS (
            SELECT 1 FROM subscriptions s 
            WHERE s.user_id = u.id AND s.status = 'active'
          )
        `);

        await client.query('COMMIT');
        
        if (res.rowCount && res.rowCount > 0) {
          console.log(`[Billing Worker] Downgraded ${res.rowCount} users to Free plan.`);
        }
      } catch (err) {
        await client.query('ROLLBACK');
        console.error('[Billing Worker] Error processing expirations:', err);
      } finally {
        client.release();
      }
    } catch (error) {
      console.error('[Billing Worker] Fatal error:', error);
    }
  });

  console.log('[Worker] Billing/Subscription worker initialized.');
}
