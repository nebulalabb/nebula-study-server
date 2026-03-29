/**
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 */
export const up = (pgm) => {
  pgm.addColumn('feed_posts', {
    feeling: { type: 'jsonb', default: null }
  });
};

export const down = (pgm) => {
  pgm.dropColumn('feed_posts', 'feeling');
};
