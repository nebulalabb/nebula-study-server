/**
 * Migration — exams, exam_questions, exam_attempts, attempt_answers
 *
 * @type {import('node-pg-migrate').ColumnDefinitions | undefined}
 */
export const shorthands = undefined;

/**
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 */
export const up = (pgm) => {
  pgm.sql(`
    -- ── 6.1 exams ──────────────────────────────────────────────
    CREATE TABLE exams (
        id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        creator_id      UUID REFERENCES users(id) ON DELETE SET NULL,
        title           TEXT NOT NULL,
        description     TEXT,
        subject         TEXT NOT NULL,
        grade_level     TEXT,
        duration_minutes INTEGER NOT NULL DEFAULT 45,
        total_questions INTEGER NOT NULL DEFAULT 0,
        total_points    NUMERIC(6,2) NOT NULL DEFAULT 0,
        is_ai_generated BOOLEAN NOT NULL DEFAULT FALSE,
        is_public       BOOLEAN NOT NULL DEFAULT TRUE,
        pass_score      NUMERIC(5,2),
        deleted_at      TIMESTAMPTZ,
        created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TRIGGER trg_exams_updated_at
        BEFORE UPDATE ON exams
        FOR EACH ROW EXECUTE FUNCTION set_updated_at();

    CREATE INDEX idx_exams_subject_grade
        ON exams (subject, grade_level, created_at DESC)
        WHERE deleted_at IS NULL AND is_public = TRUE;

    -- ── 6.2 exam_questions ───────────────────────────────────────
    CREATE TABLE exam_questions (
        id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        exam_id         UUID NOT NULL REFERENCES exams(id) ON DELETE CASCADE,
        question_text   TEXT NOT NULL,
        question_image_url TEXT,
        question_type   TEXT NOT NULL DEFAULT 'single_choice'
                            CHECK (question_type IN (
                                'single_choice',
                                'multi_choice',
                                'true_false',
                                'fill_blank'
                            )),
        options         JSONB,
        correct_answers JSONB NOT NULL,
        explanation     TEXT,
        points          NUMERIC(5,2) NOT NULL DEFAULT 1,
        difficulty      TEXT CHECK (difficulty IN ('easy', 'medium', 'hard')),
        topic_tag       TEXT,
        sort_order      INTEGER NOT NULL DEFAULT 0,
        created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE INDEX idx_exam_questions_exam_id
        ON exam_questions (exam_id, sort_order ASC);

    -- ── 6.3 exam_attempts ────────────────────────────────────────
    CREATE TABLE exam_attempts (
        id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        exam_id         UUID NOT NULL REFERENCES exams(id) ON DELETE CASCADE,
        user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        status          TEXT NOT NULL DEFAULT 'in_progress'
                            CHECK (status IN ('in_progress', 'submitted', 'timeout')),
        started_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        submitted_at    TIMESTAMPTZ,
        time_spent_sec  INTEGER,
        score           NUMERIC(6,2),
        max_score       NUMERIC(6,2),
        percentage      NUMERIC(5,2),
        passed          BOOLEAN,
        analysis        JSONB,
        created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE INDEX idx_exam_attempts_user_id
        ON exam_attempts (user_id, created_at DESC);

    -- ── 6.4 attempt_answers ──────────────────────────────────────
    CREATE TABLE attempt_answers (
        id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        attempt_id      UUID NOT NULL REFERENCES exam_attempts(id) ON DELETE CASCADE,
        question_id     UUID NOT NULL REFERENCES exam_questions(id) ON DELETE CASCADE,
        selected_answers JSONB NOT NULL DEFAULT '[]',
        is_correct      BOOLEAN,
        points_earned   NUMERIC(5,2) NOT NULL DEFAULT 0,
        time_spent_sec  INTEGER,
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
    DROP TABLE IF EXISTS attempt_answers;
    DROP INDEX IF EXISTS idx_exam_attempts_user_id;
    DROP TABLE IF EXISTS exam_attempts;
    DROP INDEX IF EXISTS idx_exam_questions_exam_id;
    DROP TABLE IF EXISTS exam_questions;
    DROP INDEX IF EXISTS idx_exams_subject_grade;
    DROP TABLE IF EXISTS exams;
  `);
};
