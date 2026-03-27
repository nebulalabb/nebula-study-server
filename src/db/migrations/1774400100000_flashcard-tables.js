/**
 * Migration — flashcard_sets, flashcards, review_schedules
 * Theo Database.md mục 4 (Tasks 4.1.1)
 *
 * @type {import('node-pg-migrate').ColumnDefinitions | undefined}
 */
export const shorthands = undefined;

/**
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 */
export const up = (pgm) => {
  pgm.sql(`
    -- ── 4.1 flashcard_sets ──────────────────────────────────────────────────
    CREATE TABLE flashcard_sets (
        id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        title           TEXT NOT NULL,
        description     TEXT,
        subject         TEXT,
        source_type     TEXT CHECK (source_type IN ('pdf', 'text', 'manual')),
        source_url      TEXT,
        card_count      INTEGER NOT NULL DEFAULT 0,
        is_public       BOOLEAN NOT NULL DEFAULT FALSE,
        deleted_at      TIMESTAMPTZ,
        created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TRIGGER trg_flashcard_sets_updated_at
        BEFORE UPDATE ON flashcard_sets
        FOR EACH ROW EXECUTE FUNCTION set_updated_at();

    CREATE INDEX idx_flashcard_sets_user_id
        ON flashcard_sets (user_id, created_at DESC)
        WHERE deleted_at IS NULL;

    -- ── 4.2 flashcards ──────────────────────────────────────────────────────
    CREATE TABLE flashcards (
        id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        set_id          UUID NOT NULL REFERENCES flashcard_sets(id) ON DELETE CASCADE,
        front           TEXT NOT NULL,
        back            TEXT NOT NULL,
        hint            TEXT,
        image_url       TEXT,
        audio_url       TEXT,
        sort_order      INTEGER NOT NULL DEFAULT 0,
        created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TRIGGER trg_flashcards_updated_at
        BEFORE UPDATE ON flashcards
        FOR EACH ROW EXECUTE FUNCTION set_updated_at();

    CREATE INDEX idx_flashcards_set_id
        ON flashcards (set_id, sort_order);

    -- ── 4.3 review_schedules ────────────────────────────────────────────────
    -- SM-2 Spaced Repetition Algorithm
    CREATE TABLE review_schedules (
        id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id             UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        flashcard_id        UUID NOT NULL REFERENCES flashcards(id) ON DELETE CASCADE,

        -- SM-2 fields
        repetition          INTEGER NOT NULL DEFAULT 0,
        easiness_factor     NUMERIC(4,2) NOT NULL DEFAULT 2.5,
        interval_days       INTEGER NOT NULL DEFAULT 1,
        next_review_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        last_reviewed_at    TIMESTAMPTZ,
        last_quality        INTEGER CHECK (last_quality BETWEEN 0 AND 5),

        created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),

        UNIQUE (user_id, flashcard_id)
    );

    CREATE TRIGGER trg_review_schedules_updated_at
        BEFORE UPDATE ON review_schedules
        FOR EACH ROW EXECUTE FUNCTION set_updated_at();

    -- Index for due-card queries (critical path — used every session)
    CREATE INDEX idx_review_schedules_due
        ON review_schedules (user_id, next_review_at);

    CREATE INDEX idx_review_schedules_user_flashcard
        ON review_schedules (user_id, flashcard_id);
  `);
};

/**
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 */
export const down = (pgm) => {
  pgm.sql(`
    DROP INDEX IF EXISTS idx_review_schedules_user_flashcard;
    DROP INDEX IF EXISTS idx_review_schedules_due;
    DROP TABLE IF EXISTS review_schedules;
    DROP INDEX IF EXISTS idx_flashcards_set_id;
    DROP TABLE IF EXISTS flashcards;
    DROP INDEX IF EXISTS idx_flashcard_sets_user_id;
    DROP TABLE IF EXISTS flashcard_sets;
  `);
};
