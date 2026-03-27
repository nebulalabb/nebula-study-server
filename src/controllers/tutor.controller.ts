import { Request, Response, NextFunction } from 'express';
import { db } from '../db/index.js';
import { sendSuccess } from '../utils/response.js';
import { AppError, ERROR_CODES } from '../utils/AppError.js';

export class TutorController {
  
  // ── 10.1.2 POST /tutor/register ───────────────────────────────────────────
  static async registerProfile(req: Request, res: Response, next: NextFunction) {
    try {
      const user = req.user!;
      const { bio, education, experience_years, hourly_rate_vnd, teaching_style, video_intro_url, subjects, availabilities } = req.body;

      const existing = await db.queryOne('SELECT id, status FROM tutor_profiles WHERE user_id = $1', [user.id]);
      if (existing) {
        if (existing.status === 'pending') throw new AppError('Hồ sơ đang chờ duyệt', 400, ERROR_CODES.VALIDATION_FAILED);
        throw new AppError('Bạn đã đăng ký gia sư', 400, ERROR_CODES.VALIDATION_FAILED);
      }

      const client = await db.getClient();
      try {
        await client.query('BEGIN');
        
        // 1. Create Profile
        const { rows: profiles } = await client.query(`
          INSERT INTO tutor_profiles (
            user_id, bio, education, experience_years, hourly_rate_vnd, hourly_rate_min, teaching_style, video_intro_url, status
          ) VALUES ($1, $2, $3, $4, $5, $5, $6, $7, 'pending')
          RETURNING id
        `, [user.id, bio, education, experience_years, hourly_rate_vnd, teaching_style, video_intro_url]);
        
        const tutorId = profiles[0].id;

        // 2. Insert Subjects
        if (subjects && Array.isArray(subjects)) {
          for (const s of subjects) {
            await client.query(`
              INSERT INTO tutor_subjects (tutor_id, subject, grade_levels, proficiency)
              VALUES ($1, $2, $3, $4)
            `, [tutorId, s.subject, s.grade_levels || '{}', s.proficiency || 'advanced']);
          }
        }

        // 3. Insert Availabilities
        if (availabilities && Array.isArray(availabilities)) {
          for (const a of availabilities) {
             await client.query(`
               INSERT INTO tutor_availabilities (tutor_id, day_of_week, start_time, end_time)
               VALUES ($1, $2, $3, $4)
             `, [tutorId, a.day_of_week, a.start_time, a.end_time]);
          }
        }

        await client.query('COMMIT');
        return sendSuccess(res, { message: 'Đăng ký hồ sơ gia sư thành công', tutor_id: tutorId });
      } catch (err) {
        await client.query('ROLLBACK');
        throw err;
      } finally {
        client.release();
      }
    } catch (err) { next(err); }
  }

  // ── 10.1.3 GET /tutor ─────────────────────────────────────────────────────
  static async searchTutors(req: Request, res: Response, next: NextFunction) {
    try {
      const { subject, limit = 20, offset = 0 } = req.query;

      let q = `
        SELECT p.id, p.hourly_rate_vnd, p.rating_avg, p.review_count, p.experience_years, u.full_name, u.avatar_url,
               array_agg(DISTINCT ts.subject) as subjects
        FROM tutor_profiles p
        JOIN users u ON p.user_id = u.id
        LEFT JOIN tutor_subjects ts ON p.id = ts.tutor_id
        WHERE p.status = 'approved' AND p.is_available = TRUE AND p.deleted_at IS NULL
      `;

      const params: any[] = [];
      let paramIndex = 1;

      if (subject) {
        q += ' AND EXISTS (SELECT 1 FROM tutor_subjects ts2 WHERE ts2.tutor_id = p.id AND ts2.subject = $' + paramIndex + ')';
        params.push(subject);
        paramIndex++;
      }

      q += ' GROUP BY p.id, u.id ORDER BY p.rating_avg DESC, p.review_count DESC LIMIT $' + paramIndex + ' OFFSET $' + (paramIndex + 1);
      params.push(Number(limit));
      params.push(Number(offset));

      const { rows } = await db.query(q, params);
      return sendSuccess(res, { items: rows });
    } catch (err) { next(err); }
  }

  // ── 10.1.4 GET /tutor/:id ─────────────────────────────────────────────────
  static async getTutorProfile(req: Request, res: Response, next: NextFunction) {
    try {
      const { id } = req.params;
      
      const profile = await db.queryOne(`
        SELECT p.*, u.full_name, u.avatar_url
        FROM tutor_profiles p JOIN users u ON p.user_id = u.id
        WHERE p.id = $1 AND p.deleted_at IS NULL
      `, [id]);
      if (!profile) throw new AppError('Không tìm thấy gia sư', 404, ERROR_CODES.RESOURCE_NOT_FOUND);

      const [ { rows: subjects }, { rows: availabilities }, { rows: reviews } ] = await Promise.all([
        db.query(`SELECT subject, grade_levels, proficiency FROM tutor_subjects WHERE tutor_id = $1`, [id]),
        db.query(`SELECT day_of_week, start_time, end_time FROM tutor_availabilities WHERE tutor_id = $1 AND is_active = TRUE ORDER BY day_of_week`, [id]),
        db.query(`
          SELECT r.rating, r.comment, r.created_at, u.full_name, u.avatar_url 
          FROM booking_reviews r JOIN users u ON r.reviewer_id = u.id 
          WHERE r.tutor_id = $1 AND r.is_public = TRUE 
          ORDER BY r.created_at DESC LIMIT 10
        `, [id])
      ]);

      return sendSuccess(res, { profile, subjects, availabilities, reviews });
    } catch (err) { next(err); }
  }

  // ── 10.1.5 POST /tutor/:id/book ───────────────────────────────────────────
  static async bookSession(req: Request, res: Response, next: NextFunction) {
    try {
      const student = req.user!;
      const { id: tutor_id } = req.params;
      const { subject, session_date, start_time, duration_minutes, notes } = req.body;

      if (!subject || !session_date || !start_time || !duration_minutes) {
        throw new AppError('Thiếu thông tin đặt lịch', 400, ERROR_CODES.VALIDATION_FAILED);
      }

      const tutor = await db.queryOne('SELECT user_id, hourly_rate_vnd, status, is_available FROM tutor_profiles WHERE id = $1', [tutor_id]);
      if (!tutor || tutor.status !== 'approved' || !tutor.is_available) {
        throw new AppError('Gia sư không khả dụng', 400, ERROR_CODES.VALIDATION_FAILED);
      }
      if (tutor.user_id === student.id) {
        throw new AppError('Không thể tự đặt lịch mình', 400, ERROR_CODES.VALIDATION_FAILED);
      }

      // Calculate end time
      const startDateTime = new Date(`\${session_date}T\${start_time}`);
      if (startDateTime.getTime() < Date.now()) {
        throw new AppError('Thời gian đặt lịch phải ở tương lai', 400, ERROR_CODES.VALIDATION_FAILED);
      }
      const endDateTime = new Date(startDateTime.getTime() + duration_minutes * 60000);
      const end_time = endDateTime.toTimeString().split(' ')[0]; // HH:MM:SS

      // Financials
      const price_vnd = Math.round((tutor.hourly_rate_vnd / 60) * duration_minutes);
      const commission_rate = 0.12; // 12% fee
      const commission_vnd = Math.round(price_vnd * commission_rate);
      const tutor_payout_vnd = price_vnd - commission_vnd;

      const { rows } = await db.query(`
        INSERT INTO bookings (
          student_id, tutor_id, subject, session_date, start_time, end_time, duration_minutes,
          price_vnd, commission_rate, commission_vnd, tutor_payout_vnd, platform, notes, status
        ) VALUES (
          $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, 'google_meet', $12, 'pending'
        ) RETURNING id
      `, [
        student.id, tutor_id, subject, session_date, start_time, end_time, duration_minutes,
        price_vnd, commission_rate, commission_vnd, tutor_payout_vnd, notes
      ]);

      return sendSuccess(res, { message: 'Tạo booking thành công chờ thanh toán', booking_id: rows[0].id, price_vnd });
    } catch (err) { next(err); }
  }

  // ── 10.1.7 POST /tutor/booking/:booking_id/review ─────────────────────────
  static async reviewBooking(req: Request, res: Response, next: NextFunction) {
    try {
      const student = req.user!;
      const { booking_id } = req.params;
      const { rating, comment } = req.body;

      if (!rating || rating < 1 || rating > 5) throw new AppError('Điểm đánh giá phải từ 1 đến 5', 400, ERROR_CODES.VALIDATION_FAILED);

      const booking = await db.queryOne("SELECT * FROM bookings WHERE id = $1 AND student_id = $2 AND status = 'completed'", [booking_id, student.id]);
      if (!booking) throw new AppError('Không thể đánh giá booking này', 403, ERROR_CODES.FORBIDDEN);

      const existing = await db.queryOne('SELECT id FROM booking_reviews WHERE booking_id = $1', [booking.id]);
      if (existing) throw new AppError('Bạn đã đánh giá buổi học này rồi', 400, ERROR_CODES.VALIDATION_FAILED);

      const client = await db.getClient();
      try {
        await client.query('BEGIN');
        
        await client.query(`
          INSERT INTO booking_reviews (booking_id, reviewer_id, tutor_id, rating, comment)
          VALUES ($1, $2, $3, $4, $5)
        `, [booking.id, student.id, booking.tutor_id, rating, comment]);

        // Update rating average
        const rStats = await client.query(`
          SELECT AVG(rating)::NUMERIC(3,2) as avg_r, COUNT(*) as cnt 
          FROM booking_reviews WHERE tutor_id = $1 AND is_public = TRUE
        `, [booking.tutor_id]);

        await client.query(`
          UPDATE tutor_profiles SET rating_avg = $1, review_count = $2 WHERE id = $3
        `, [rStats.rows[0].avg_r || 0, rStats.rows[0].cnt || 0, booking.tutor_id]);

        await client.query('COMMIT');
        return sendSuccess(res, { message: 'Cảm ơn bạn đã đánh giá!' });
      } catch (err) {
        await client.query('ROLLBACK');
        throw err;
      } finally {
        client.release();
      }
    } catch (err) { next(err); }
  }

  // ── 10.1.8 GET /tutor/my-bookings (Học sinh) ──────────────────────────────
  static async getMyBookings(req: Request, res: Response, next: NextFunction) {
    try {
      const student = req.user!;
      const { rows } = await db.query(`
        SELECT b.*, t.rating_avg, u.full_name as tutor_name, u.avatar_url as tutor_avatar
        FROM bookings b
        JOIN tutor_profiles t ON b.tutor_id = t.id
        JOIN users u ON t.user_id = u.id
        WHERE b.student_id = $1
        ORDER BY b.session_date DESC, b.start_time DESC
      `, [student.id]);
      return sendSuccess(res, { items: rows });
    } catch (err) { next(err); }
  }

  // ── 10.1.9 GET /tutor/my-sessions (Gia sư) ────────────────────────────────
  static async getMySessions(req: Request, res: Response, next: NextFunction) {
    try {
      const user = req.user!;
      const tutor = await db.queryOne('SELECT id FROM tutor_profiles WHERE user_id = $1', [user.id]);
      if (!tutor) throw new AppError('Bạn chưa là gia sư', 403, ERROR_CODES.FORBIDDEN);

      const { rows } = await db.query(`
        SELECT b.*, u.full_name as student_name, u.avatar_url as student_avatar
        FROM bookings b
        JOIN users u ON b.student_id = u.id
        WHERE b.tutor_id = $1
        ORDER BY b.session_date DESC, b.start_time DESC
      `, [tutor.id]);
      return sendSuccess(res, { items: rows });
    } catch (err) { next(err); }
  }
}
