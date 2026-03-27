/**
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 */
export const up = (pgm) => {
  pgm.sql(`
    ALTER TABLE messages 
    ADD COLUMN type TEXT NOT NULL DEFAULT 'text'
    CHECK (type IN ('text', 'image', 'video', 'sticker', 'icon')),
    ADD COLUMN metadata JSONB NOT NULL DEFAULT '{}';
  `);
};

/**
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 */
export const down = (pgm) => {
  pgm.sql(`
    ALTER TABLE messages 
    DROP COLUMN type,
    DROP COLUMN metadata;
  `);
};
