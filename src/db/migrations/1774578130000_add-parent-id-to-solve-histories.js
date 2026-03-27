/**
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 */
export const up = (pgm) => {
  pgm.sql(`
    ALTER TABLE solve_histories ADD COLUMN parent_id UUID REFERENCES solve_histories(id) ON DELETE SET NULL;
    CREATE INDEX idx_solve_histories_parent_id ON solve_histories(parent_id);
  `);
};

/**
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 */
export const down = (pgm) => {
  pgm.sql(`
    DROP INDEX IF EXISTS idx_solve_histories_parent_id;
    ALTER TABLE solve_histories DROP COLUMN IF EXISTS parent_id;
  `);
};
