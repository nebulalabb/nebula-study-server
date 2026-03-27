/**
 * Seed data — 5 learning_topics & sample daily_lessons for Phase 9
 *
 * @type {import('node-pg-migrate').ColumnDefinitions | undefined}
 */
export const shorthands = undefined;

/**
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 */
export const up = (pgm) => {
  pgm.sql(`
    -- Seed Topics
    WITH t1 AS (
      INSERT INTO learning_topics (name, slug, description, lesson_count, sort_order)
      VALUES ('Tiếng Anh giao tiếp', 'tieng-anh-giao-tiep', 'Học 5 phút mỗi ngày để tự tin giao tiếp.', 2, 1) RETURNING id
    ),
    t2 AS (
      INSERT INTO learning_topics (name, slug, description, lesson_count, sort_order)
      VALUES ('Kỹ năng quản lý thời gian', 'time-management', 'Nắm vững nghệ thuật kiểm soát thời gian.', 1, 2) RETURNING id
    ),
    t3 AS (
      INSERT INTO learning_topics (name, slug, description, lesson_count, sort_order)
      VALUES ('Tư duy Lập trình', 'tu-duy-lap-trinh', 'Cấu trúc dữ liệu và giải thuật cơ bản.', 1, 3) RETURNING id
    )
    
    -- Seed Lessons for Tiếng Anh
    INSERT INTO daily_lessons (topic_id, title, content, day_index, quiz_question)
    SELECT id, 'Ngày 1: Chào hỏi cơ bản', 'Hôm nay chúng ta học cách chào hỏi: Hello, How are you?, I am fine thank you.', 1, 
           '{"question": "Đâu là câu trả lời phổ biến cho How are you?", "options": [{"id":"A","text":"I''m fine thank you"},{"id":"B","text":"I am a student"}], "correct":"A"}'::jsonb
    FROM t1 UNION ALL
    
    SELECT id, 'Ngày 2: Giới thiệu bản thân', 'My name is John. I am a software engineer.', 2,
           '{"question": "My name ... John", "options": [{"id":"A","text":"is"},{"id":"B","text":"are"}], "correct":"A"}'::jsonb
    FROM t1 UNION ALL
    
    -- Seed Lessons for Time Management
    SELECT id, 'Ngày 1: Ma trận Eisenhower', 'Là phương pháp chia công việc thành 4 ô: Gấp và Quan trọng, Không gấp nhưng Quan trọng...', 1,
           '{"question": "Ô nào quan trọng nhất trong dài hạn?", "options": [{"id":"A","text":"Không gấp nhưng Quan trọng"},{"id":"B","text":"Gấp và Quan trọng"}], "correct":"A"}'::jsonb
    FROM t2 UNION ALL

    -- Seed Lessons for Lập trình
    SELECT id, 'Ngày 1: Khái niệm biến', 'Biến là hộp chứa dữ liệu.', 1,
           '{"question": "Biến là gì?", "options": [{"id":"A","text":"Hộp chứa dữ liệu"},{"id":"B","text":"Là một ngôn ngữ"}], "correct":"A"}'::jsonb
    FROM t3;
  `);
};

/**
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 */
export const down = (pgm) => {
  pgm.sql(`
    DELETE FROM learning_topics WHERE slug IN ('tieng-anh-giao-tiep', 'time-management', 'tu-duy-lap-trinh');
  `);
};
