/**
 * Migration — Add share_token to flashcard_sets
 */
export const shorthands = undefined;

/**
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 */
export const up = (pgm) => {
  pgm.addColumns('flashcard_sets', {
    share_token: { type: 'UUID', unique: true, default: pgm.func('gen_random_uuid()') },
  });
  pgm.createIndex('flashcard_sets', 'share_token', { where: 'is_public = TRUE' });
};

/**
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 */
export const down = (pgm) => {
  pgm.dropIndex('flashcard_sets', 'share_token');
  pgm.dropColumns('flashcard_sets', ['share_token']);
};
