import { Request, Response, NextFunction } from 'express';
import { db } from '../db/index.js';
import { sendSuccess } from '../utils/response.js';
import { AppError, ERROR_CODES } from '../utils/AppError.js';
import { NotificationService } from '../services/notification.service.js';

export class AdminController {

  // ── 12.1.2 GET /admin/stats ────────────────────────────────────────────────
  static async getDashboardStats(req: Request, res: Response, next: NextFunction) {
    try {
      const [usersRes, premiumRes, revenueRes, todayRevenueRes, activeBookingsRes] = await Promise.all([
        db.queryOne('SELECT COUNT(*) as total FROM users WHERE deleted_at IS NULL'),
        db.queryOne("SELECT COUNT(*) as total FROM users WHERE plan = 'premium'"),
        db.queryOne("SELECT COALESCE(SUM(amount_vnd), 0) as total FROM payments WHERE status = 'success'"),
        db.queryOne("SELECT COALESCE(SUM(amount_vnd), 0) as total FROM payments WHERE status = 'success' AND DATE(paid_at) = CURRENT_DATE"),
        db.queryOne("SELECT COUNT(*) as total FROM bookings WHERE status = 'confirmed'")
      ]);

      return sendSuccess(res, {
        users: {
          total: Number(usersRes?.total || 0),
          premium: Number(premiumRes?.total || 0),
        },
        revenue: {
          all_time_vnd: Number(revenueRes?.total || 0),
          today_vnd: Number(todayRevenueRes?.total || 0),
        },
        bookings: {
          active: Number(activeBookingsRes?.total || 0),
        }
      });
    } catch (err) { next(err); }
  }

  // ── 12.1.3 GET /admin/users ─────────────────────────────────────────────────
  static async listUsers(req: Request, res: Response, next: NextFunction) {
    try {
      const { q, plan, limit = 20, offset = 0 } = req.query;

      let query = `
        SELECT id, full_name, email, avatar_url, plan, is_active, created_at, plan_expires_at
        FROM users WHERE deleted_at IS NULL
      `;
      const params: any[] = [];
      let pi = 1;

      if (q) {
        query += ` AND (full_name ILIKE $${pi} OR email ILIKE $${pi})`;
        params.push(`%${q}%`);
        pi++;
      }
      if (plan) {
        query += ` AND plan = $${pi}`;
        params.push(plan);
        pi++;
      }

      query += ` ORDER BY created_at DESC LIMIT $${pi} OFFSET $${pi + 1}`;
      params.push(Number(limit), Number(offset));

      const { rows } = await db.query(query, params);
      const countRes = await db.queryOne('SELECT COUNT(*) as total FROM users WHERE deleted_at IS NULL');

      return sendSuccess(res, { items: rows, total: Number(countRes?.total || 0) });
    } catch (err) { next(err); }
  }

  // ── 12.1.3 PATCH /admin/users/:id ──────────────────────────────────────────
  static async updateUser(req: Request, res: Response, next: NextFunction) {
    try {
      const { id } = req.params;
      const { plan, is_active } = req.body;

      const allowedPlans = ['free', 'premium'];
      if (plan && !allowedPlans.includes(plan)) {
        throw new AppError('Gói cước không hợp lệ', 400, ERROR_CODES.VALIDATION_FAILED);
      }

      const fields: string[] = [];
      const vals: any[] = [];
      let pi = 1;

      if (plan !== undefined) { fields.push(`plan = $${pi++}`); vals.push(plan); }
      if (is_active !== undefined) { fields.push(`is_active = $${pi++}`); vals.push(is_active); }

      if (fields.length === 0) throw new AppError('Không có gì để cập nhật', 400, ERROR_CODES.VALIDATION_FAILED);

      vals.push(id);
      const { rowCount } = await db.query(
        `UPDATE users SET ${fields.join(', ')}, updated_at = NOW() WHERE id = $${pi}`,
        vals
      );
      if (rowCount === 0) throw new AppError('Không tìm thấy người dùng', 404, ERROR_CODES.RESOURCE_NOT_FOUND);

      return sendSuccess(res, { message: 'Cập nhật user thành công' });
    } catch (err) { next(err); }
  }

  // ── 12.1.4 GET /admin/tutors ────────────────────────────────────────────────
  static async listTutors(req: Request, res: Response, next: NextFunction) {
    try {
      const { status = 'pending', limit = 20, offset = 0 } = req.query;

      const { rows } = await db.query(`
        SELECT p.id, p.hourly_rate_vnd, p.rating_avg, p.review_count, p.experience_years, p.is_verified, p.status, p.created_at,
               u.full_name, u.email, u.avatar_url
        FROM tutor_profiles p
        JOIN users u ON p.user_id = u.id
        WHERE p.status = $1 AND p.deleted_at IS NULL
        ORDER BY p.created_at DESC
        LIMIT $2 OFFSET $3
      `, [status, Number(limit), Number(offset)]);

      return sendSuccess(res, { items: rows });
    } catch (err) { next(err); }
  }

  // ── 12.1.4 PATCH /admin/tutors/:id/:action ─────────────────────────────────
  static async updateTutorStatus(req: Request, res: Response, next: NextFunction) {
    try {
      const { id, action } = req.params;
      const actionStr = String(action || '');
      const validActions: { [key: string]: string } = {
        approve: 'approved',
        reject: 'pending',
        suspend: 'suspended',
      };

      const newStatus = validActions[actionStr];
      if (!newStatus) throw new AppError('Hành động không hợp lệ', 400, ERROR_CODES.VALIDATION_FAILED);

      const client = await db.getClient();
      try {
        await client.query('BEGIN');

        const is_verified = actionStr === 'approve';
        
        // 1. Update Tutor Profile Status
        const { rows: profiles } = await client.query(
          'UPDATE tutor_profiles SET status = $1, is_verified = $2, updated_at = NOW() WHERE id = $3 RETURNING user_id',
          [newStatus, is_verified, id]
        );
        if (profiles.length === 0) throw new AppError('Không tìm thấy hồ sơ gia sư', 404, ERROR_CODES.RESOURCE_NOT_FOUND);
        
        const userId = profiles[0].user_id;

        // 2. If approved, upgrade user role to 'tutor'
        if (actionStr === 'approve') {
          await client.query("UPDATE users SET role = 'tutor', updated_at = NOW() WHERE id = $1", [userId]);
          
          // 3. Notify user
          await NotificationService.createNotification(
            userId,
            'tutor_approved',
            'Chúc mừng! Hồ sơ gia sư đã được duyệt',
            'Bạn đã chính thức trở thành Gia sư trên Nebula. Hãy bắt đầu cập nhật lịch rảnh và sẵn sàng nhận học sinh nhé!',
            { tutor_id: id }
          );
        }

        await client.query('COMMIT');
        return sendSuccess(res, { message: `Đã ${actionStr} hồ sơ gia sư thành công` });
      } catch (err) {
        await client.query('ROLLBACK');
        throw err;
      } finally {
        client.release();
      }
    } catch (err) { next(err); }
  }

  // ── 12.1.5 GET /admin/exams ──────────────────────────────────────────────
  static async listExams(req: Request, res: Response, next: NextFunction) {
    try {
      const { subject, limit = 20, offset = 0 } = req.query;
      let query = 'SELECT id, title, subject, grade_level, duration_minutes, total_questions, is_public, created_at FROM exams WHERE deleted_at IS NULL';
      const params: any[] = [];
      if (subject) { query += ' AND subject = $1'; params.push(subject); }
      query += ` ORDER BY created_at DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`;
      params.push(Number(limit), Number(offset));
      const { rows } = await db.query(query, params);
      return sendSuccess(res, { items: rows });
    } catch (err) { next(err); }
  }

  static async toggleExamPublish(req: Request, res: Response, next: NextFunction) {
    try {
      const { id } = req.params;
      const { is_public } = req.body;
      const { rowCount } = await db.query(
        'UPDATE exams SET is_public = $1, updated_at = NOW() WHERE id = $2',
        [Boolean(is_public), id]
      );
      if (rowCount === 0) throw new AppError('Không tìm thấy đề thi', 404, ERROR_CODES.RESOURCE_NOT_FOUND);
      return sendSuccess(res, { message: is_public ? 'Đã công khai đề thi' : 'Đã ẩn đề thi' });
    } catch (err) { next(err); }
  }

  static async deleteExam(req: Request, res: Response, next: NextFunction) {
    try {
      const { id } = req.params;
      const { rowCount } = await db.query(
        'UPDATE exams SET deleted_at = NOW() WHERE id = $1 AND deleted_at IS NULL',
        [id]
      );
      if (rowCount === 0) throw new AppError('Không tìm thấy đề thi', 404, ERROR_CODES.RESOURCE_NOT_FOUND);
      return sendSuccess(res, { message: 'Đã xoá đề thi' });
    } catch (err) { next(err); }
  }

  // ── 12.1.6 GET /admin/lessons ─────────────────────────────────────────────
  static async listLessons(req: Request, res: Response, next: NextFunction) {
    try {
      const { topic_id, limit = 20, offset = 0 } = req.query;
      let query = `
        SELECT dl.id, dl.title, dl.day_index, dl.estimated_minutes, dl.created_at,
               lt.name as topic_name
        FROM daily_lessons dl
        JOIN learning_topics lt ON dl.topic_id = lt.id
        WHERE 1=1
      `;
      const params: any[] = [];
      if (topic_id) { query += ' AND dl.topic_id = $1'; params.push(topic_id); }
      query += ` ORDER BY dl.created_at DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`;
      params.push(Number(limit), Number(offset));
      const { rows } = await db.query(query, params);
      return sendSuccess(res, { items: rows });
    } catch (err) { next(err); }
  }

  static async createLesson(req: Request, res: Response, next: NextFunction) {
    try {
      const { topic_id, title, content, day_index, estimated_minutes, quiz_question } = req.body;
      if (!topic_id || !title || !content) {
        throw new AppError('Thiếu thông tin bài học', 400, ERROR_CODES.VALIDATION_FAILED);
      }
      const { rows } = await db.query(`
        INSERT INTO daily_lessons (topic_id, title, content, day_index, estimated_minutes, quiz_question)
        VALUES ($1, $2, $3, $4, $5, $6) RETURNING id
      `, [topic_id, title, content, day_index || 1, estimated_minutes || 5, JSON.stringify(quiz_question || null)]);
      return sendSuccess(res, { lesson_id: rows[0].id });
    } catch (err) { next(err); }
  }

  static async updateLesson(req: Request, res: Response, next: NextFunction) {
    try {
      const { id } = req.params;
      const { title, content, estimated_minutes, quiz_question } = req.body;
      const { rowCount } = await db.query(`
        UPDATE daily_lessons SET
          title = COALESCE($1, title),
          content = COALESCE($2, content),
          estimated_minutes = COALESCE($3, estimated_minutes),
          quiz_question = COALESCE($4, quiz_question)
        WHERE id = $5
      `, [title, content, estimated_minutes, quiz_question ? JSON.stringify(quiz_question) : null, id]);
      if (rowCount === 0) throw new AppError('Không tìm thấy bài học', 404, ERROR_CODES.RESOURCE_NOT_FOUND);
      return sendSuccess(res, { message: 'Cập nhật bài học thành công' });
    } catch (err) { next(err); }
  }

  static async deleteLesson(req: Request, res: Response, next: NextFunction) {
    try {
      const { id } = req.params;
      const { rowCount } = await db.query('DELETE FROM daily_lessons WHERE id = $1', [id]);
      if (rowCount === 0) throw new AppError('Không tìm thấy bài học', 404, ERROR_CODES.RESOURCE_NOT_FOUND);
      return sendSuccess(res, { message: 'Đã xoá bài học' });
    } catch (err) { next(err); }
  }

  // ── 12.1.7 POST /admin/lessons/generate-ai ──────────────────────────────
  static async generateLessonAI(req: Request, res: Response, next: NextFunction) {
    try {
      const { topic_id, topic_name, keywords, difficulty = 'medium', is_free = true } = req.body;
      
      if (!topic_id || !topic_name) {
        throw new AppError('Thiếu topic_id hoặc topic_name', 400, ERROR_CODES.VALIDATION_FAILED);
      }

      const { generateMicroLessonPayload } = await import('../utils/microlearn-prompt.js');
      const payload = await generateMicroLessonPayload({ topic: topic_name, keywords, difficulty });

      const { rows } = await db.query(`
        INSERT INTO daily_lessons (topic_id, title, content, estimated_minutes, quiz_question, is_free, publish_date)
        VALUES ($1, $2, $3, $4, $5, $6, CURRENT_DATE)
        RETURNING id
      `, [
        topic_id, 
        payload.title, 
        payload.content, 
        payload.estimated_minutes || 5, 
        JSON.stringify(payload.quiz_question),
        is_free,
        // publish_date is set to today by default
      ]);

      return sendSuccess(res, { lesson_id: rows[0].id, lesson: payload });
    } catch (err) { next(err); }
  }

  // ── SUPPORT REQUESTS ────────────────────────────────────────────────────────
  static async listSupportRequests(req: Request, res: Response, next: NextFunction) {
    try {
      const { status, limit = 20, offset = 0 } = req.query;
      let query = `
        SELECT sr.*, u.full_name, u.email, u.avatar_url
        FROM support_requests sr
        JOIN users u ON sr.user_id = u.id
        WHERE 1=1
      `;
      const params: any[] = [];
      if (status) {
        query += ' AND sr.status = $1';
        params.push(status);
      }
      query += ` ORDER BY sr.created_at DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`;
      params.push(Number(limit), Number(offset));

      const { rows } = await db.query(query, params);
      return sendSuccess(res, { items: rows });
    } catch (err) { next(err); }
  }

  static async updateSupportRequest(req: Request, res: Response, next: NextFunction) {
    try {
      const { id } = req.params;
      const { status, admin_notes } = req.body;

      const fields: string[] = [];
      const vals: any[] = [];
      let pi = 1;

      if (status) { fields.push(`status = $${pi++}`); vals.push(status); }
      if (admin_notes !== undefined) { fields.push(`admin_notes = $${pi++}`); vals.push(admin_notes); }

      if (fields.length === 0) throw new AppError('Không có gì để cập nhật', 400, ERROR_CODES.VALIDATION_FAILED);

      vals.push(id);
      const { rowCount } = await db.query(
        `UPDATE support_requests SET ${fields.join(', ')}, updated_at = NOW() WHERE id = $${pi}`,
        vals
      );

      if (rowCount === 0) throw new AppError('Không tìm thấy yêu cầu hỗ trợ', 404, ERROR_CODES.RESOURCE_NOT_FOUND);

      // Notify the user about the update
      const updatedRequest = await db.queryOne('SELECT user_id, title FROM support_requests WHERE id = $1', [id]);
      if (updatedRequest && (status || admin_notes)) {
        const statusMap: Record<string, string> = {
          'pending': 'Đang chờ',
          'in_progress': 'Đang xử lý',
          'resolved': 'Đã hoàn thành',
          'closed': 'Đã đóng'
        };
        const statusVi = statusMap[status] || 'Đang cập nhật';
        
        await NotificationService.createNotification(
          updatedRequest.user_id,
          'support_update',
          'Cập nhật yêu cầu hỗ trợ',
          `Yêu cầu "${updatedRequest.title}" đã được chuyển sang trạng thái: ${statusVi}.`,
          { request_id: id }
        );
      }

      return sendSuccess(res, { message: 'Cập nhật yêu cầu hỗ trợ thành công' });
    } catch (err) { next(err); }
  }
}

