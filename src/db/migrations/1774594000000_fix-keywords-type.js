/**
 * Migration — Change note_summaries.keywords type to JSONB
 */
export const up = (pgm) => {
  pgm.sql(`
    -- 1. Xóa default cũ (đang là '{}' cho TEXT[])
    ALTER TABLE note_summaries ALTER COLUMN keywords DROP DEFAULT;

    -- 2. Chuyển kiểu dữ liệu sang JSONB
    ALTER TABLE note_summaries 
    ALTER COLUMN keywords TYPE JSONB USING keywords::TEXT::JSONB;

    -- 3. Cập nhật DEFAULT mới là '[]'
    ALTER TABLE note_summaries 
    ALTER COLUMN keywords SET DEFAULT '[]';
  `);
};

export const down = (pgm) => {
  pgm.sql(`
    ALTER TABLE note_summaries 
    ALTER COLUMN keywords TYPE TEXT[] USING keywords::TEXT::TEXT[];
    
    ALTER TABLE note_summaries 
    ALTER COLUMN keywords SET DEFAULT '{}';
  `);
};
