/**
 * Migration — Notifications System
 *
 * @type {import('node-pg-migrate').ColumnDefinitions | undefined}
 */
export const shorthands = undefined;

/**
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 */
export const up = (pgm) => {
  pgm.sql(`
    CREATE TABLE notifications (
        id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        type        TEXT NOT NULL CHECK (type IN (
                        'flashcard_review_due',
                        'streak_reminder',
                        'booking_confirmed',
                        'booking_reminder',
                        'payment_success',
                        'payment_failed',
                        'system'
                    )),
        title       TEXT NOT NULL,
        body        TEXT NOT NULL,
        data        JSONB NOT NULL DEFAULT '{}',
        is_read     BOOLEAN NOT NULL DEFAULT FALSE,
        read_at     TIMESTAMPTZ,
        created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE INDEX idx_notifications_user_id ON notifications(user_id);
    CREATE INDEX idx_notifications_is_read ON notifications(is_read);
  `);
};

/**
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 */
export const down = (pgm) => {
  pgm.sql(`
    DROP TABLE IF EXISTS notifications;
  `);
};
