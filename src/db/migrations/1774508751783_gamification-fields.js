/**
 * @type {import('node-pg-migrate').ColumnDefinitions | undefined}
 */
export const shorthands = undefined;

/**
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 * @param run {() => void | undefined}
 * @returns {Promise<void> | void}
 */
export const up = (pgm) => {
  pgm.sql(`
    -- Add gamification columns to users table
    ALTER TABLE users
    ADD COLUMN IF NOT EXISTS xp              INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS level           INTEGER NOT NULL DEFAULT 1,
    ADD COLUMN IF NOT EXISTS streak          INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS last_active_at  TIMESTAMPTZ;

    -- Index for ranking (optimization)
    CREATE INDEX IF NOT EXISTS idx_users_xp_desc ON users (xp DESC);
  `);
};

/**
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 * @param run {() => void | undefined}
 * @returns {Promise<void> | void}
 */
export const down = (pgm) => {
  pgm.sql(`
    DROP INDEX IF EXISTS idx_users_xp_desc;
    ALTER TABLE users 
    DROP COLUMN IF EXISTS xp,
    DROP COLUMN IF EXISTS level,
    DROP COLUMN IF EXISTS streak,
    DROP COLUMN IF EXISTS last_active_at;
  `);
};
