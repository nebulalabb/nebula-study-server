/**
 * Migration 011 — solve_histories table
 * Theo Database.md mục 5
 *
 * @type {import('node-pg-migrate').ColumnDefinitions | undefined}
 */
export const shorthands = undefined;

/**
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 */
export const up = (pgm) => {
  pgm.sql(`
    CREATE TABLE IF NOT EXISTS solve_histories (
        id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,

        -- Input
        subject         TEXT NOT NULL DEFAULT 'general',
        question_text   TEXT,
        question_image_url TEXT,
        input_type      TEXT NOT NULL DEFAULT 'text'
                            CHECK (input_type IN ('text', 'image', 'mixed')),

        -- Output
        solution        TEXT NOT NULL,          -- Full markdown+LaTeX solution
        steps           JSONB NOT NULL DEFAULT '[]', -- Structured steps array
        explanation     TEXT,                   -- Short plain-text summary
        confidence      NUMERIC(4,3),           -- 0.000–1.000

        -- Metadata
        tokens_used     INTEGER NOT NULL DEFAULT 0,
        model_version   TEXT NOT NULL DEFAULT 'gemini-2.5-flash',
        solve_time_ms   INTEGER,               -- Time taken to solve in milliseconds

        -- Soft delete
        deleted_at      TIMESTAMPTZ,
        created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    -- Index for user history pagination
    CREATE INDEX idx_solve_histories_user_id_created
        ON solve_histories (user_id, created_at DESC)
        WHERE deleted_at IS NULL;

    -- Index for subject filtering
    CREATE INDEX idx_solve_histories_subject
        ON solve_histories (user_id, subject)
        WHERE deleted_at IS NULL;
  `);
};

/**
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 */
export const down = (pgm) => {
  pgm.sql(`
    DROP INDEX IF EXISTS idx_solve_histories_subject;
    DROP INDEX IF EXISTS idx_solve_histories_user_id_created;
    DROP TABLE IF EXISTS solve_histories;
  `);
};
