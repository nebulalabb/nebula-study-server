/**
 * Migration — Update Notification Types
 * 
 * Adds 'friend_request' and 'friend_accepted' to the allowed types in notifications table.
 *
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 */
export const up = (pgm) => {
  pgm.sql(`
    ALTER TABLE notifications 
    DROP CONSTRAINT notifications_type_check;

    ALTER TABLE notifications 
    ADD CONSTRAINT notifications_type_check 
    CHECK (type IN (
        'flashcard_review_due',
        'streak_reminder',
        'booking_confirmed',
        'booking_reminder',
        'payment_success',
        'payment_failed',
        'system',
        'friend_request',
        'friend_accepted'
    ));
  `);
};

export const down = (pgm) => {
  pgm.sql(`
    ALTER TABLE notifications 
    DROP CONSTRAINT notifications_type_check;

    ALTER TABLE notifications 
    ADD CONSTRAINT notifications_type_check 
    CHECK (type IN (
        'flashcard_review_due',
        'streak_reminder',
        'booking_confirmed',
        'booking_reminder',
        'payment_success',
        'payment_failed',
        'system'
    ));
  `);
};
