/**
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 */
export const up = (pgm) => {
  pgm.sql(`
    -- Add missing fields to daily_lessons
    ALTER TABLE daily_lessons ADD COLUMN IF NOT EXISTS is_free BOOLEAN NOT NULL DEFAULT TRUE;
    ALTER TABLE daily_lessons ADD COLUMN IF NOT EXISTS publish_date DATE;
    
    -- Add notification_time to user_streaks
    ALTER TABLE user_streaks ADD COLUMN IF NOT EXISTS notification_time TIME;
  `);
};

/**
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 */
export const down = (pgm) => {
  pgm.sql(`
    ALTER TABLE user_streaks DROP COLUMN IF EXISTS notification_time;
    ALTER TABLE daily_lessons DROP COLUMN IF EXISTS publish_date;
    ALTER TABLE daily_lessons DROP COLUMN IF EXISTS is_free;
  `);
};
