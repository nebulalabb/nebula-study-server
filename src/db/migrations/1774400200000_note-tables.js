/**
 * Migration — notes, note_summaries
 * Theo Database.md mục 8 (Tasks 5.1.1)
 *
 * @type {import('node-pg-migrate').ColumnDefinitions | undefined}
 */
export const shorthands = undefined;

/**
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 */
export const up = (pgm) => {
  pgm.sql(`
    -- ── 8.1 notes ───────────────────────────────────────────────────────────
    CREATE TABLE notes (
        id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        title           TEXT NOT NULL DEFAULT 'Untitled Note',
        source_type     TEXT CHECK (source_type IN ('text', 'pdf', 'url', 'docx')),
        source_content  TEXT,
        source_url      TEXT,
        word_count      INTEGER,
        tags            TEXT[] NOT NULL DEFAULT '{}',
        is_pinned       BOOLEAN NOT NULL DEFAULT FALSE,
        deleted_at      TIMESTAMPTZ,
        created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TRIGGER trg_notes_updated_at
        BEFORE UPDATE ON notes
        FOR EACH ROW EXECUTE FUNCTION set_updated_at();

    CREATE INDEX idx_notes_user_id
        ON notes (user_id, created_at DESC)
        WHERE deleted_at IS NULL;

    -- Index hỗ trợ search (GIN array overlap cho tags)
    CREATE INDEX idx_notes_tags
        ON notes USING GIN (tags);

    -- ── 8.2 note_summaries ──────────────────────────────────────────────────
    CREATE TABLE note_summaries (
        id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        note_id         UUID NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
        summary_short   TEXT NOT NULL,
        bullet_points   JSONB NOT NULL DEFAULT '[]',
        keywords        TEXT[] NOT NULL DEFAULT '{}',
        full_summary    TEXT,
        model_used      TEXT NOT NULL DEFAULT 'gemini-2.5-pro',
        tokens_used     INTEGER NOT NULL DEFAULT 0,
        created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE INDEX idx_note_summaries_note_id
        ON note_summaries (note_id);
  `);
};

/**
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 */
export const down = (pgm) => {
  pgm.sql(`
    DROP INDEX IF EXISTS idx_note_summaries_note_id;
    DROP TABLE IF EXISTS note_summaries;
    DROP INDEX IF EXISTS idx_notes_tags;
    DROP INDEX IF EXISTS idx_notes_user_id;
    DROP TABLE IF EXISTS notes;
  `);
};
