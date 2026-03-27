/**
 * Seed data — 1 verified premium tutor for testing
 *
 * @type {import('node-pg-migrate').ColumnDefinitions | undefined}
 */
export const shorthands = undefined;

/**
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 */
export const up = (pgm) => {
  pgm.sql(`
    DO $$
    DECLARE
        admin_uid UUID;
        tutor_pid UUID;
    BEGIN
        SELECT id INTO admin_uid FROM users WHERE email = 'admin@nebulalab.vn' LIMIT 1;
        
        IF admin_uid IS NOT NULL THEN
            -- Create Profile
            INSERT INTO tutor_profiles (user_id, bio, education, experience_years, hourly_rate_vnd, teaching_style, is_verified, is_available, status, rating_avg, review_count)
            VALUES (admin_uid, 'Giáo viên tận tâm, kết hợp AI và công nghệ giáo dục.', 'Đại học Bách Khoa TP.HCM', 5, 200000, 'Truyền cảm hứng, tập trung thực hành', TRUE, TRUE, 'approved', 4.9, 15)
            RETURNING id INTO tutor_pid;
            
            -- Subjects
            INSERT INTO tutor_subjects (tutor_id, subject, grade_levels, proficiency)
            VALUES (tutor_pid, 'Toán học', ARRAY['10', '11', '12'], 'expert');
            
            INSERT INTO tutor_subjects (tutor_id, subject, grade_levels, proficiency)
            VALUES (tutor_pid, 'Tiếng Anh', ARRAY['IELTS', 'TOEIC'], 'expert');

            -- Availabilities (T7, CN rảnh buổi tối)
            INSERT INTO tutor_availabilities (tutor_id, day_of_week, start_time, end_time)
            VALUES (tutor_pid, 0, '19:00:00', '22:00:00');

            INSERT INTO tutor_availabilities (tutor_id, day_of_week, start_time, end_time)
            VALUES (tutor_pid, 6, '18:00:00', '21:00:00');
        END IF;
    END $$;
  `);
};

/**
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 */
export const down = (pgm) => {
  pgm.sql(`
    DELETE FROM tutor_profiles WHERE bio LIKE '%Giáo viên tận tâm%';
  `);
};
