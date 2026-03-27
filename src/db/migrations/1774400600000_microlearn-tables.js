/**
 * Migration — Micro-learning tables: learning_topics, daily_lessons, user_lesson_progress, user_streaks, user_topic_subscriptions
 *
 * @type {import('node-pg-migrate').ColumnDefinitions | undefined}
 */
export const shorthands = undefined;

/**
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 */
export const up = (pgm) => {
  pgm.sql(`
    -- ── 7.1 learning_topics ──────────────────────────────────────
    CREATE TABLE learning_topics (
        id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        name            TEXT NOT NULL,
        slug            TEXT UNIQUE NOT NULL,
        icon_url        TEXT,
        description     TEXT,
        lesson_count    INTEGER NOT NULL DEFAULT 0,
        is_active       BOOLEAN NOT NULL DEFAULT TRUE,
        sort_order      INTEGER NOT NULL DEFAULT 0,
        created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    -- ── 7.2 daily_lessons ────────────────────────────────────────
    CREATE TABLE daily_lessons (
        id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        topic_id        UUID NOT NULL REFERENCES learning_topics(id) ON DELETE CASCADE,
        title           TEXT NOT NULL,
        content         TEXT NOT NULL,
        content_html    TEXT,
        estimated_minutes INTEGER NOT NULL DEFAULT 5,
        lesson_date     DATE,
        day_index       INTEGER,
        is_premium      BOOLEAN NOT NULL DEFAULT FALSE,
        quiz_question   JSONB,
        created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TRIGGER trg_daily_lessons_updated_at
        BEFORE UPDATE ON daily_lessons
        FOR EACH ROW EXECUTE FUNCTION set_updated_at();

    -- ── 7.X user_topic_subscriptions ──────────────────────────────
    CREATE TABLE user_topic_subscriptions (
        id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        topic_id        UUID NOT NULL REFERENCES learning_topics(id) ON DELETE CASCADE,
        subscribed_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        current_day     INTEGER NOT NULL DEFAULT 1,
        UNIQUE (user_id, topic_id)
    );

    -- ── 7.3 user_lesson_progress ──────────────────────────────────
    CREATE TABLE user_lesson_progress (
        id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        lesson_id       UUID NOT NULL REFERENCES daily_lessons(id) ON DELETE CASCADE,
        topic_id        UUID NOT NULL REFERENCES learning_topics(id) ON DELETE CASCADE,
        status          TEXT NOT NULL DEFAULT 'not_started'
                            CHECK (status IN ('not_started', 'in_progress', 'completed')),
        quiz_answered   BOOLEAN NOT NULL DEFAULT FALSE,
        quiz_correct    BOOLEAN,
        completed_at    TIMESTAMPTZ,
        created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        UNIQUE (user_id, lesson_id)
    );

    -- ── 7.4 user_streaks ──────────────────────────────────────────
    CREATE TABLE user_streaks (
        id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id             UUID UNIQUE NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        current_streak      INTEGER NOT NULL DEFAULT 0,
        longest_streak      INTEGER NOT NULL DEFAULT 0,
        last_activity_date  DATE,
        total_days_learned  INTEGER NOT NULL DEFAULT 0,
        updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
};

/**
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 */
export const down = (pgm) => {
  pgm.sql(`
    DROP TABLE IF EXISTS user_streaks;
    DROP TABLE IF EXISTS user_lesson_progress;
    DROP TABLE IF EXISTS user_topic_subscriptions;
    DROP TABLE IF EXISTS daily_lessons;
    DROP TABLE IF EXISTS learning_topics;
  `);
};
