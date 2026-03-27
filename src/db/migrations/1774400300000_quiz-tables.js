/**
 * Migration — quiz_sets, quiz_questions, quiz_attempts, quiz_answers
 * Theo Database.md mục 10 (Tasks 6.1.1)
 *
 * @type {import('node-pg-migrate').ColumnDefinitions | undefined}
 */
export const shorthands = undefined;

/**
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 */
export const up = (pgm) => {
  pgm.sql(`
    -- ── 10.1 quiz_sets ──────────────────────────────────────────────────────
    CREATE TABLE quiz_sets (
        id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        title           TEXT NOT NULL,
        description     TEXT,
        source_type     TEXT CHECK (source_type IN ('text', 'pdf', 'manual')),
        source_url      TEXT,
        question_count  INTEGER NOT NULL DEFAULT 0,
        difficulty      TEXT CHECK (difficulty IN ('easy', 'medium', 'hard', 'mixed')),
        is_public       BOOLEAN NOT NULL DEFAULT FALSE,
        share_token     TEXT UNIQUE,
        play_count      INTEGER NOT NULL DEFAULT 0,
        deleted_at      TIMESTAMPTZ,
        created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TRIGGER trg_quiz_sets_updated_at
        BEFORE UPDATE ON quiz_sets
        FOR EACH ROW EXECUTE FUNCTION set_updated_at();

    CREATE INDEX idx_quiz_sets_user_id
        ON quiz_sets (user_id, created_at DESC)
        WHERE deleted_at IS NULL;

    -- ── 10.2 quiz_questions ─────────────────────────────────────────────────
    CREATE TABLE quiz_questions (
        id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        quiz_id         UUID NOT NULL REFERENCES quiz_sets(id) ON DELETE CASCADE,
        question_text   TEXT NOT NULL,
        question_type   TEXT NOT NULL DEFAULT 'single_choice'
                            CHECK (question_type IN ('single_choice', 'true_false', 'fill_blank')),
        options         JSONB,
        correct_answers JSONB NOT NULL,
        explanation     TEXT,
        points          INTEGER NOT NULL DEFAULT 1,
        sort_order      INTEGER NOT NULL DEFAULT 0,
        created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE INDEX idx_quiz_questions_quiz_id
        ON quiz_questions (quiz_id, sort_order);

    -- ── 10.3 quiz_attempts ──────────────────────────────────────────────────
    CREATE TABLE quiz_attempts (
        id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        quiz_id         UUID NOT NULL REFERENCES quiz_sets(id) ON DELETE CASCADE,
        user_id         UUID REFERENCES users(id) ON DELETE SET NULL, -- có thể null nếu public
        guest_name      TEXT,
        status          TEXT NOT NULL DEFAULT 'in_progress'
                            CHECK (status IN ('in_progress', 'completed')),
        score           INTEGER NOT NULL DEFAULT 0,
        max_score       INTEGER NOT NULL DEFAULT 0,
        percentage      NUMERIC(5,2),
        time_spent_sec  INTEGER,
        completed_at    TIMESTAMPTZ,
        created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE INDEX idx_quiz_attempts_quiz_id
        ON quiz_attempts (quiz_id, created_at DESC);

    CREATE INDEX idx_quiz_attempts_user_id
        ON quiz_attempts (user_id, created_at DESC);

    -- ── 10.4 quiz_answers ───────────────────────────────────────────────────
    CREATE TABLE quiz_answers (
        id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        attempt_id      UUID NOT NULL REFERENCES quiz_attempts(id) ON DELETE CASCADE,
        question_id     UUID NOT NULL REFERENCES quiz_questions(id) ON DELETE CASCADE,
        selected_answers JSONB NOT NULL DEFAULT '[]',
        is_correct      BOOLEAN,
        points_earned   INTEGER NOT NULL DEFAULT 0,
        created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        UNIQUE (attempt_id, question_id)
    );
  `);
};

/**
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 */
export const down = (pgm) => {
  pgm.sql(`
    DROP TABLE IF EXISTS quiz_answers;
    DROP INDEX IF EXISTS idx_quiz_attempts_user_id;
    DROP INDEX IF EXISTS idx_quiz_attempts_quiz_id;
    DROP TABLE IF EXISTS quiz_attempts;
    DROP INDEX IF EXISTS idx_quiz_questions_quiz_id;
    DROP TABLE IF EXISTS quiz_questions;
    DROP INDEX IF EXISTS idx_quiz_sets_user_id;
    DROP TABLE IF EXISTS quiz_sets;
  `);
};
