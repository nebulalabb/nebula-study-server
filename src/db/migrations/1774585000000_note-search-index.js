/**
 * Migration — note full-text search
 */
export const up = (pgm) => {
  pgm.sql(`
    -- Thêm index Full-text search cho notes (title)
    CREATE INDEX idx_notes_title_fts ON notes USING GIN (to_tsvector('simple', title));

    -- Thêm index Full-text search cho note_summaries (summary_short)
    CREATE INDEX idx_note_summaries_text_fts ON note_summaries USING GIN (to_tsvector('simple', summary_short));
  `);
};

export const down = (pgm) => {
  pgm.sql(`
    DROP INDEX IF EXISTS idx_note_summaries_text_fts;
    DROP INDEX IF EXISTS idx_notes_title_fts;
  `);
};
