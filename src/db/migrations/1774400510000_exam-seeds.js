/**
 * Seed data — 3-5 Exam sets for Math & English
 *
 * @type {import('node-pg-migrate').ColumnDefinitions | undefined}
 */
export const shorthands = undefined;

/**
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 */
export const up = (pgm) => {
  pgm.sql(`
    -- We assume the 'system' or 'admin' user might not exist, so we use creator_id = NULL for official exams.
    -- To keep it simple, we insert with a known UUID or let gen_random_uuid do its thing and fetch the IDs.
    
    WITH exam_math AS (
      INSERT INTO exams (title, description, subject, grade_level, duration_minutes, total_questions, total_points, is_public, pass_score)
      VALUES 
      ('Đề Thi Thử THPT Quốc Gia - Môn Toán', 'Đề bám sát cấu trúc Bộ GD&ĐT', 'math', '12', 90, 3, 3.0, true, 50.0)
      RETURNING id
    )
    INSERT INTO exam_questions (exam_id, question_text, question_type, options, correct_answers, explanation, points, difficulty, topic_tag, sort_order)
    SELECT id, 'Hàm số y = x^3 - 3x^2 + 2 đồng biến trên khoảng nào?', 'single_choice', 
           '[{"id": "A", "text": "(-∞; 0) và (2; +∞)"}, {"id": "B", "text": "(0; 2)"}, {"id": "C", "text": "(-2; 0)"}, {"id": "D", "text": "(-∞; 2)"}]'::jsonb, 
           '["A"]'::jsonb, 'Đạo hàm y'' = 3x^2 - 6x. y'' = 0 khi x = 0 hoặc x = 2. Khảo sát dấu ta thấy đồng biến trên (-∞; 0) và (2; +∞).', 1, 'medium', 'Hàm số', 1
    FROM exam_math UNION ALL
    SELECT id, 'Nghiệm của phương trình $\log_2(x-1) = 3$ là:', 'single_choice',
           '[{"id": "A", "text": "x = 9"}, {"id": "B", "text": "x = 8"}, {"id": "C", "text": "x = 7"}, {"id": "D", "text": "x = 10"}]'::jsonb,
           '["A"]'::jsonb, 'Điều kiện x > 1. Ta có $x-1 = 2^3 = 8 \implies x = 9$.', 1, 'easy', 'Logarit', 2
    FROM exam_math UNION ALL
    SELECT id, 'Tính tích phân $\int_0^1 e^{2x} dx$', 'single_choice',
           '[{"id": "A", "text": "$(e^2-1)/2$"}, {"id": "B", "text": "$e^2-1$"}, {"id": "C", "text": "$e^2/2$"}, {"id": "D", "text": "$(e^2+1)/2$"}]'::jsonb,
           '["A"]'::jsonb, 'Nguyên hàm của $e^{2x}$ là $\frac{1}{2}e^{2x}$. Tích phân $\frac{1}{2}(e^2 - e^0) = \frac{e^2 - 1}{2}$.', 1, 'medium', 'Tích phân', 3
    FROM exam_math;

    WITH exam_eng AS (
      INSERT INTO exams (title, description, subject, grade_level, duration_minutes, total_questions, total_points, is_public, pass_score)
      VALUES 
      ('IELTS Reading Practice Test 1', 'Standard IELTS Reading passage with mixed question types.', 'english', 'ielts', 20, 3, 3.0, true, 60.0)
      RETURNING id
    )
    INSERT INTO exam_questions (exam_id, question_text, question_type, options, correct_answers, explanation, points, difficulty, topic_tag, sort_order)
    SELECT id, 'Read the passage... What is the main idea of the first paragraph?', 'single_choice',
           '[{"id": "A", "text": "Climate change is unpreventable"}, {"id": "B", "text": "Human activities heavily impact global temperatures"}, {"id": "C", "text": "The ozone layer is healing"}, {"id": "D", "text": "Animals are adapting to new environments"}]'::jsonb,
           '["B"]'::jsonb, 'The paragraph explicitly discusses industrial activities and their role in CO2 emission, driving global temperatures.', 1, 'medium', 'Reading Comprehension', 1
    FROM exam_eng UNION ALL
    SELECT id, 'The word "**alleviate**" in line 4 is closest in meaning to:', 'single_choice',
           '[{"id": "A", "text": "exacerbate"}, {"id": "B", "text": "relieve"}, {"id": "C", "text": "determine"}, {"id": "D", "text": "worsen"}]'::jsonb,
           '["B"]'::jsonb, 'Alleviate means to make suffering or a problem less severe, which is synonymous with relieve.', 1, 'easy', 'Vocabulary', 2
    FROM exam_eng UNION ALL
    SELECT id, 'Industrialization has brought zero negative consequences to the ecosystem.', 'true_false',
           '[{"id": "T", "text": "True"}, {"id": "F", "text": "False"}]'::jsonb,
           '["F"]'::jsonb, 'The text mentions numerous negative consequences, including pollution and habitat loss.', 1, 'easy', 'True/False/Not Given', 3
    FROM exam_eng;
  `);
};

/**
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 */
export const down = (pgm) => {
  pgm.sql(`
    DELETE FROM exams WHERE title IN ('Đề Thi Thử THPT Quốc Gia - Môn Toán', 'IELTS Reading Practice Test 1');
  `);
};
