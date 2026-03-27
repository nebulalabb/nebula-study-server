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
        const ALLOWED_SUBJECTS = ['Toán học', 'Tiếng Anh'];
        if (subjects && Array.isArray(subjects)) {
          for (const s of subjects) {
            if (!ALLOWED_SUBJECTS.includes(s.subject)) {
              throw new AppError(`Môn học ${s.subject} chưa được hỗ trợ ở Phase 1`, 400, ERROR_CODES.VALIDATION_FAILED);
            }
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

  // ── 10.1.3 GET /tutor/my-profile ──────────────────────────────────────────
  static async getMyProfile(req: Request, res: Response, next: NextFunction) {
    try {
      const user = req.user!;
      const profile = await db.queryOne(`
        SELECT p.*, u.full_name, u.avatar_url
        FROM tutor_profiles p JOIN users u ON p.user_id = u.id
        WHERE p.user_id = $1 AND p.deleted_at IS NULL
      `, [user.id]);
      
      if (!profile) return sendSuccess(res, { profile: null });
      
      const { rows: subjects } = await db.query(`SELECT * FROM tutor_subjects WHERE tutor_id = $1`, [profile.id]);
      return sendSuccess(res, { profile, subjects });
    } catch (err) { next(err); }
  }

  // ── 10.1.4 GET /tutor ─────────────────────────────────────────────────────
  static async searchTutors(req: Request, res: Response, next: NextFunction) {
    try {
      const { subject, min_rating, price_min, price_max, date, limit = 20, offset = 0 } = req.query;

      let q = `
        SELECT p.id, p.hourly_rate_vnd, p.rating_avg, p.review_count, p.experience_years, u.full_name, u.avatar_url,
               array_agg(DISTINCT ts.subject) as subjects
        FROM tutor_profiles p
        JOIN users u ON p.user_id = u.id
        LEFT JOIN tutor_subjects ts ON p.id = ts.tutor_id
        WHERE p.status = 'approved' AND p.is_available = TRUE AND p.deleted_at IS NULL
      `;

      const params: any[] = [];
      let pi = 1;

      if (subject) {
        q += ' AND EXISTS (SELECT 1 FROM tutor_subjects ts2 WHERE ts2.tutor_id = p.id AND ts2.subject = $' + pi + ')';
        params.push(subject);
        pi++;
      }

      if (min_rating) {
        q += ' AND p.rating_avg >= $' + pi;
        params.push(Number(min_rating));
        pi++;
      }

      if (price_min) {
        q += ' AND p.hourly_rate_vnd >= $' + pi;
        params.push(Number(price_min));
        pi++;
      }

      if (price_max) {
        q += ' AND p.hourly_rate_vnd <= $' + pi;
        params.push(Number(price_max));
        pi++;
      }

      if (date) {
        const dayOfWeek = new Date(date as string).getDay();
        q += ' AND EXISTS (SELECT 1 FROM tutor_availabilities ta WHERE ta.tutor_id = p.id AND ta.day_of_week = $' + pi + ' AND ta.is_active = TRUE)';
        params.push(dayOfWeek);
        pi++;
      }

       q += ' GROUP BY p.id, u.id ORDER BY p.rating_avg DESC, p.review_count DESC LIMIT $' + (pi++) + ' OFFSET $' + pi;
       params.push(Number(limit));
       params.push(Number(offset));

       const [ { rows: items }, { rows: countRow } ] = await Promise.all([
         db.query(q, params),
         db.query(`SELECT COUNT(*)::int as count FROM tutor_profiles WHERE status = 'approved' AND is_available = TRUE AND deleted_at IS NULL`)
       ]);

       const totalCount = countRow[0]?.count ? Number(countRow[0].count) : 0;
       console.log('Search results count:', items.length, 'Global count:', totalCount);

       return sendSuccess(res, { 
         items, 
         total: totalCount
       });
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

  // ── 10.1.13 GET /tutor/:id/availability ──────────────────────────────────
  static async getDayAvailability(req: Request, res: Response, next: NextFunction) {
    try {
      const { id } = req.params;
      const { date } = req.query; // format YYYY-MM-DD

      if (!date) throw new AppError('Thiếu ngày cần xem', 400, ERROR_CODES.VALIDATION_FAILED);

      const dayOfWeek = new Date(date as string).getDay();

      // 1. Get base availabilities
      const { rows: slots } = await db.query(`
        SELECT start_time, end_time FROM tutor_availabilities 
        WHERE tutor_id = $1 AND day_of_week = $2 AND is_active = TRUE
      `, [id, dayOfWeek]);

      // 2. Get existing confirmed bookings for this day
      const { rows: bookings } = await db.query(`
        SELECT start_time, end_time FROM bookings
        WHERE tutor_id = $1 AND session_date = $2 AND status IN ('confirmed', 'completed')
      `, [id, date]);

      return sendSuccess(res, { date, slots, bookings });
    } catch (err) { next(err); }
  }

  // ── 10.1.10 PATCH /tutor/profile ──────────────────────────────────────────
  static async updateProfile(req: Request, res: Response, next: NextFunction) {
    try {
      const user = req.user!;
      const { bio, education, experience_years, hourly_rate_vnd, teaching_style, video_intro_url } = req.body;

      const profile = await db.queryOne('SELECT id FROM tutor_profiles WHERE user_id = $1', [user.id]);
      if (!profile) throw new AppError('Không tìm thấy hồ sơ gia sư', 404, ERROR_CODES.RESOURCE_NOT_FOUND);

      const fields: string[] = [];
      const vals: any[] = [];
      let pi = 1;

      if (bio !== undefined) { fields.push(`bio = $${pi++}`); vals.push(bio); }
      if (education !== undefined) { fields.push(`education = $${pi++}`); vals.push(education); }
      if (experience_years !== undefined) { fields.push(`experience_years = $${pi++}`); vals.push(experience_years); }
      if (hourly_rate_vnd !== undefined) { fields.push(`hourly_rate_vnd = $${pi++}`); vals.push(hourly_rate_vnd); }
      if (teaching_style !== undefined) { fields.push(`teaching_style = $${pi++}`); vals.push(teaching_style); }
      if (video_intro_url !== undefined) { fields.push(`video_intro_url = $${pi++}`); vals.push(video_intro_url); }

      if (fields.length === 0) throw new AppError('Không có thông tin cập nhật', 400, ERROR_CODES.VALIDATION_FAILED);

      vals.push(profile.id);
      await db.query(`UPDATE tutor_profiles SET ${fields.join(', ')}, updated_at = NOW() WHERE id = $${pi}`, vals);

      return sendSuccess(res, { message: 'Cập nhật hồ sơ thành công' });
    } catch (err) { next(err); }
  }

  // ── 10.1.11 PATCH /tutor/availability ─────────────────────────────────────
  static async updateAvailability(req: Request, res: Response, next: NextFunction) {
    try {
      const user = req.user!;
      const { availabilities } = req.body; // Array of { day_of_week, start_time, end_time }

      const profile = await db.queryOne('SELECT id FROM tutor_profiles WHERE user_id = $1', [user.id]);
      if (!profile) throw new AppError('Không tìm thấy hồ sơ gia sư', 404, ERROR_CODES.RESOURCE_NOT_FOUND);

      const client = await db.getClient();
      try {
        await client.query('BEGIN');
        
        // Replace all existing availabilities
        await client.query('DELETE FROM tutor_availabilities WHERE tutor_id = $1', [profile.id]);
        
        if (availabilities && Array.isArray(availabilities)) {
          for (const a of availabilities) {
            await client.query(`
              INSERT INTO tutor_availabilities (tutor_id, day_of_week, start_time, end_time)
              VALUES ($1, $2, $3, $4)
            `, [profile.id, a.day_of_week, a.start_time, a.end_time]);
          }
        }

        await client.query('COMMIT');
        return sendSuccess(res, { message: 'Cập nhật lịch rảnh thành công' });
      } catch (err) {
        await client.query('ROLLBACK');
        throw err;
      } finally {
        client.release();
      }
    } catch (err) { next(err); }
  }

  // ── 10.1.12 PATCH /tutor/profile/toggle-availability ──────────────────────
  static async toggleAvailability(req: Request, res: Response, next: NextFunction) {
    try {
      const user = req.user!;
      const { is_available } = req.body;

      const { rowCount } = await db.query(
        'UPDATE tutor_profiles SET is_available = $1 WHERE user_id = $2',
        [Boolean(is_available), user.id]
      );
      if (rowCount === 0) throw new AppError('Không tìm thấy hồ sơ gia sư', 404, ERROR_CODES.RESOURCE_NOT_FOUND);

      return sendSuccess(res, { message: `Đã ${is_available ? 'mở' : 'tạm dừng'} nhận booking` });
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
      const startDateTime = new Date(`${session_date}T${start_time}`);
      if (startDateTime.getTime() < Date.now()) {
        throw new AppError('Thời gian đặt lịch phải ở tương lai', 400, ERROR_CODES.VALIDATION_FAILED);
      }
      const endDateTime = new Date(startDateTime.getTime() + duration_minutes * 60000);
      const end_time = endDateTime.toTimeString().split(' ')[0]; // HH:MM:SS

      // Conflict Check & Booking in Transaction
      const client = await db.getClient();
      try {
        await client.query('BEGIN');

        // 1. Lock tutor schedule for this day to prevent race conditions
        // Actually, we just need to check for overlaps
        const overlap = await client.query(`
          SELECT 1 FROM bookings 
          WHERE tutor_id = $1 AND session_date = $2 AND status IN ('confirmed', 'pending')
          AND (
            (start_time <= $3 AND end_time > $3) OR
            (start_time < $4 AND end_time >= $4) OR
            (start_time >= $3 AND end_time <= $4)
          ) FOR UPDATE
        `, [tutor_id, session_date, start_time, end_time]);

        if (overlap.rowCount && overlap.rowCount > 0) {
          throw new AppError('Khung giờ này đã có người đặt hoặc đang chờ thanh toán', 400, ERROR_CODES.VALIDATION_FAILED);
        }

        // 2. Financials
        const price_vnd = Math.round((tutor.hourly_rate_vnd / 60) * duration_minutes);
        const commission_rate = 0.12; // 12% fee
        const commission_vnd = Math.round(price_vnd * commission_rate);
        const tutor_payout_vnd = price_vnd - commission_vnd;

        const { rows } = await client.query(`
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

        await client.query('COMMIT');
        return sendSuccess(res, { message: 'Tạo booking thành công chờ thanh toán', booking_id: rows[0].id, price_vnd });
      } catch (err) {
        await client.query('ROLLBACK');
        throw err;
      } finally {
        client.release();
      }
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

  // ── 10.1.14 PATCH /tutor/bookings/:id/status ────────────────────────────
  static async updateBookingStatus(req: Request, res: Response, next: NextFunction) {
    try {
      const user = req.user!;
      const { id } = req.params;
      const { status } = req.body; // 'confirmed', 'cancelled'

      const tutor = await db.queryOne('SELECT id FROM tutor_profiles WHERE user_id = $1', [user.id]);
      if (!tutor) throw new AppError('Không có quyền', 403, ERROR_CODES.FORBIDDEN);

      const booking = await db.queryOne('SELECT id, status FROM bookings WHERE id = $1 AND tutor_id = $2', [id, tutor.id]);
      if (!booking) throw new AppError('Không thấy booking', 404, ERROR_CODES.RESOURCE_NOT_FOUND);

      if (!['confirmed', 'cancelled'].includes(status)) {
        throw new AppError('Trạng thái không hợp lệ', 400, ERROR_CODES.VALIDATION_FAILED);
      }

      await db.query('UPDATE bookings SET status = $1, updated_at = NOW() WHERE id = $2', [status, id]);

      return sendSuccess(res, { message: `Đã cập nhật trạng thái booking thành ${status}` });
    } catch (err) { next(err); }
  }
}
