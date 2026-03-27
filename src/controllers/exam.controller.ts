import { Request, Response, NextFunction } from 'express';
import { db } from '../db/index.js';
import { sendSuccess } from '../utils/response.js';
import { AppError, ERROR_CODES } from '../utils/AppError.js';
import { generateExamPayload } from '../utils/exam-prompt.js';
import { QuotaService } from '../services/quota.service.js';

export class ExamController {

  // ── 8.1.3 GET /exam ────────────────────────────────────────────────────────
  static async listExams(req: Request, res: Response, next: NextFunction) {
    try {
      const { subject, limit = 20, offset = 0 } = req.query;
      
      let query = 'SELECT * FROM exams WHERE deleted_at IS NULL AND is_public = TRUE';
      let countQuery = 'SELECT COUNT(*) FROM exams WHERE deleted_at IS NULL AND is_public = TRUE';
      const params: any[] = [];
      const countParams: any[] = [];

      if (subject) {
        query += ' AND subject = $1';
        countQuery += ' AND subject = $1';
        params.push(subject);
        countParams.push(subject);
      }

      query += ` ORDER BY created_at DESC LIMIT ${Number(limit)} OFFSET ${Number(offset)}`;

      const { rows: items } = await db.query(query, params);
      const { rows: countRows } = await db.query(countQuery, countParams);
      const total = parseInt(countRows[0].count, 10);

      return sendSuccess(res, { items, total });
    } catch (err) { next(err); }
  }

  // ── 8.1.4 POST /exam/:exam_id/attempt/start ────────────────────────────────
  static async startAttempt(req: Request, res: Response, next: NextFunction) {
    try {
      const user = req.user!;
      const { exam_id } = req.params;

      const exam = await db.queryOne('SELECT id, is_public, duration_minutes FROM exams WHERE id = $1 AND deleted_at IS NULL', [exam_id]);
      if (!exam) throw new AppError('Đề thi không tồn tại', 404, ERROR_CODES.RESOURCE_NOT_FOUND);

      // We can consume a generic quota here if needed, or maybe just let them start. 
      // The requirement says quotaGuard('exam'), so we'll enforce that via middleware in routes.

      // Fetch questions to send back immediately
      const { rows: questions } = await db.query(
        'SELECT id, question_text, question_image_url, question_type, options, points, difficulty, sort_order FROM exam_questions WHERE exam_id = $1 ORDER BY sort_order ASC',
        [exam.id]
      );

      // Create an "in_progress" attempt
      const { rows: attempts } = await db.query(
        `INSERT INTO exam_attempts (exam_id, user_id, status, started_at) VALUES ($1, $2, 'in_progress', NOW()) RETURNING id, started_at`,
        [exam.id, user.id]
      );

      return sendSuccess(res, { 
        attempt_id: attempts[0].id, 
        started_at: attempts[0].started_at,
        duration_minutes: exam.duration_minutes,
        questions 
      });
    } catch (err) { next(err); }
  }

  // ── 8.1.5 POST /exam/attempt/:attempt_id/submit ────────────────────────────
  // Body: { answers: { [questionId]: ["A"] }, time_spent_sec: number }
  static async submitAttempt(req: Request, res: Response, next: NextFunction) {
    try {
      const user = req.user!;
      const { attempt_id } = req.params;
      const { answers = {}, time_spent_sec = 0 } = req.body;

      // 1. Get current Attempt & Exam
      const attempt = await db.queryOne(
        `SELECT a.*, e.pass_score, e.total_points 
         FROM exam_attempts a JOIN exams e ON a.exam_id = e.id 
         WHERE a.id = $1 AND a.user_id = $2 AND a.status = 'in_progress'`, 
        [attempt_id, user.id]
      );
      if (!attempt) throw new AppError('Không tìm thấy phiên làm bài hợp lệ', 404, ERROR_CODES.RESOURCE_NOT_FOUND);

      // 2. Fetch all correct questions & options
      const { rows: questions } = await db.query(
        'SELECT id, correct_answers, points, topic_tag FROM exam_questions WHERE exam_id = $1', 
        [attempt.exam_id]
      );

      let totalScore = 0;
      let maxScore = 0;
      const answerRows: any[] = [];
      const topicStats: Record<string, { correct: number, total: number }> = {};

      // 3. Score calculation
      for (const q of questions) {
        maxScore += Number(q.points);
        const selected = (answers as Record<string, string[]>)[q.id] || [];
        
        // Exact match arrays (ignoring order by sorting)
        const correctSet = [...q.correct_answers].sort().join(',');
        const selectedSet = [...selected].sort().join(',');
        
        const isCorrect = correctSet === selectedSet;
        const pointsEarned = isCorrect ? Number(q.points) : 0;
        
        totalScore += pointsEarned;
        
        answerRows.push([
          attempt.id, q.id, JSON.stringify(selected), isCorrect, pointsEarned
        ]);

        // Topic Analysis
        const topic = q.topic_tag || 'Khác';
        if (!topicStats[topic]) topicStats[topic] = { correct: 0, total: 0 };
        topicStats[topic].total += 1;
        if (isCorrect) topicStats[topic].correct += 1;
      }

      // 4. Summarize and Update DB inside transaction
      const percentage = maxScore > 0 ? (totalScore / maxScore) * 100 : 0;
      const passScore = attempt.pass_score || 50; // default 50% pass rate
      const passed = percentage >= passScore;

      const client = await db.getClient();
      try {
        await client.query('BEGIN');
        
        // Update attempt
        await client.query(
          `UPDATE exam_attempts 
           SET status = 'submitted', submitted_at = NOW(), time_spent_sec = $1, 
               score = $2, max_score = $3, percentage = $4, passed = $5, analysis = $6
           WHERE id = $7`,
           [time_spent_sec, totalScore, maxScore, percentage, passed, JSON.stringify(topicStats), attempt.id]
        );

        // Bulk insert answer rows
        if (answerRows.length > 0) {
          // Flatten
          const values = answerRows.map(row => `('${row[0]}', '${row[1]}', '${row[2]}', ${row[3]}, ${row[4]})`).join(',');
          await client.query(
            `INSERT INTO attempt_answers (attempt_id, question_id, selected_answers, is_correct, points_earned) VALUES ${values}`
          );
        }

        await client.query('COMMIT');
      } catch (e) {
        await client.query('ROLLBACK');
        throw e;
      } finally {
        client.release();
      }

      return sendSuccess(res, { attempt_id: attempt.id, score: totalScore, max_score: maxScore, percentage });
    } catch (err) { next(err); }
  }

  // ── 8.1.6 GET /exam/attempt/:attempt_id/result ─────────────────────────────
  static async getAttemptResult(req: Request, res: Response, next: NextFunction) {
    try {
      const user = req.user!;
      const { attempt_id } = req.params;

      const attempt = await db.queryOne(`
        SELECT a.*, e.title as exam_title, e.subject, e.total_questions
        FROM exam_attempts a JOIN exams e ON a.exam_id = e.id
        WHERE a.id = $1 AND a.user_id = $2
      `, [attempt_id, user.id]);

      if (!attempt) throw new AppError('Attempt not found', 404, ERROR_CODES.RESOURCE_NOT_FOUND);

      const { rows: details } = await db.query(`
        SELECT aa.question_id, aa.selected_answers, aa.is_correct, aa.points_earned,
               eq.question_text, eq.options, eq.correct_answers, eq.explanation, eq.topic_tag
        FROM attempt_answers aa
        JOIN exam_questions eq ON aa.question_id = eq.id
        WHERE aa.attempt_id = $1
      `, [attempt_id]);

      return sendSuccess(res, {
        attempt,
        details
      });
    } catch (err) { next(err); }
  }

  // ── 8.1.7 GET /exam/history ────────────────────────────────────────────────
  static async getHistory(req: Request, res: Response, next: NextFunction) {
    try {
      const user = req.user!;
      const { rows } = await db.query(`
        SELECT a.id, a.started_at, a.submitted_at, a.score, a.max_score, a.percentage, a.passed, a.status,
               e.title as exam_title, e.subject
        FROM exam_attempts a
        JOIN exams e ON a.exam_id = e.id
        WHERE a.user_id = $1
        ORDER BY a.started_at DESC LIMIT 50
      `, [user.id]);
      
      return sendSuccess(res, { items: rows });
    } catch (err) { next(err); }
  }

  // ── 8.1.8 POST /exam/generate (Premium) ────────────────────────────────────
  static async generateExam(req: Request, res: Response, next: NextFunction) {
    try {
      const user = req.user!;
      const { subject, topic, difficulty = 'medium', count = 10 } = req.body;

      if (!subject || !topic) throw new AppError('Vui lòng chọn môn học và chủ đề', 400, ERROR_CODES.VALIDATION_FAILED);

      // Must be premium or check quota engine.
      // This is managed by Quota middleware usually, but we also ensure execution.
      
      const payload = await generateExamPayload({ 
        subject, topic, difficulty, count: Number(count), 
        customModel: user.plan === 'premium' ? 'pro' : 'flash' 
      });

      // Insert generic exam
      const client = await db.getClient();
      let newExamId = '';
      try {
        await client.query('BEGIN');
        
        const examTitle = payload.title || `Đề luyện tập ${topic}`;
        const totalPts = payload.questions.length;
        
        const { rows: examRows } = await client.query(
          `INSERT INTO exams (creator_id, title, description, subject, total_questions, total_points, is_ai_generated, is_public, pass_score)
           VALUES ($1, $2, $3, $4, $5, $6, true, false, 50.0) RETURNING id`,
           [user.id, examTitle, payload.description, subject, payload.questions.length, totalPts]
        );
        newExamId = examRows[0].id;

        // Insert questions
        let sortOrder = 1;
        for (const q of payload.questions) {
          await client.query(
            `INSERT INTO exam_questions (exam_id, question_text, question_type, options, correct_answers, explanation, points, difficulty, topic_tag, sort_order)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
            [
              newExamId, q.question_text, q.question_type || 'single_choice', JSON.stringify(q.options || []),
              JSON.stringify(q.correct_answers || []), q.explanation || '', q.points || 1.0, 
              q.difficulty || 'medium', q.topic_tag || 'Khác', sortOrder++
            ]
          );
        }

        await client.query('COMMIT');
        
        // Consume quota
        await QuotaService.consumeQuota(user.id, 'exam');
      } catch (err) {
        await client.query('ROLLBACK');
        throw err;
      } finally {
        client.release();
      }

      return sendSuccess(res, { message: 'Sinh đề thành công', exam_id: newExamId });
    } catch (err) { next(err); }
  }

}
