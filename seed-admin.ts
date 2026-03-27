import { UserService } from './src/services/user.service.js';
import { AuthService } from './src/services/auth.service.js';
import { db } from './src/db/index.js';
import dotenv from 'dotenv';
dotenv.config();

async function seedAdmin() {
  try {
    const email = 'admin@nebulalab.vn';
    const passwordHash = await AuthService.hashPassword('Admin@123');

    // 1. Check if exists
    let user = await UserService.findByEmail(email);
    if (!user) {
      user = await UserService.createUser({
        email,
        passwordHash,
        fullName: 'Nebula Admin'
      });
      // Set to admin strictly
      await db.query(`UPDATE users SET role = 'admin', email_verified = true, plan = 'premium' WHERE id = $1`, [user.id]);
      console.log('✅ Admin user created:', email);
    } else {
      console.log('⚡ Admin user already exists:', email);
    }

    // 2. Ensure tutor profile since migration might have been skipped
    const tutorResult = await db.query(`
        INSERT INTO tutor_profiles (user_id, bio, education, experience_years, hourly_rate_vnd, teaching_style, is_verified, is_available, status, rating_avg, review_count)
        VALUES ($1, 'Giáo viên tận tâm.', 'Đại học Bách Khoa TP.HCM', 5, 200000, 'Truyền cảm hứng', TRUE, TRUE, 'approved', 4.9, 15)
        ON CONFLICT (user_id) DO NOTHING
        RETURNING id;
    `, [user.id]);
    
    if (tutorResult.rows.length > 0) {
        const tutorPid = tutorResult.rows[0].id;
        await db.query(`INSERT INTO tutor_subjects (tutor_id, subject, grade_levels, proficiency) VALUES ($1, 'Toán học', ARRAY['10', '11', '12'], 'expert') ON CONFLICT DO NOTHING`, [tutorPid]);
        await db.query(`INSERT INTO tutor_subjects (tutor_id, subject, grade_levels, proficiency) VALUES ($1, 'Tiếng Anh', ARRAY['IELTS', 'TOEIC'], 'expert') ON CONFLICT DO NOTHING`, [tutorPid]);
        console.log('✅ Tutor profile created for Admin!');
    }

  } catch (err) {
    console.error('❌ Error seeding:', err);
  } finally {
    process.exit(0);
  }
}

seedAdmin();
