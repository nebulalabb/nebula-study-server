import { Request, Response, NextFunction } from 'express';
import { GeminiService } from '../services/gemini.service.js';
import { QuotaService } from '../services/quota.service.js';
import { sendSuccess } from '../utils/response.js';
import { AppError, ERROR_CODES } from '../utils/AppError.js';
import {
  QUIZ_SYSTEM_PROMPT,
  buildQuizPrompt,
  buildQuizFilePrompt,
} from '../utils/quiz-prompt.js';
import cloudinary from '../utils/cloudinary.js';
import { db } from '../db/index.js';
import streamifier from 'streamifier';
import { UploadApiResponse, UploadApiErrorResponse } from 'cloudinary';
import crypto from 'crypto';

// ── Helper ───────────────────────────────────────────────────────────────────
function parseQuizOutput(text: string): Array<any> {
  const cleaned = text.replace(/^```json\s*/i, '').replace(/\s*```$/i, '').trim();
  try {
    const parsed = JSON.parse(cleaned);
    if (Array.isArray(parsed)) return parsed;
    if (parsed.questions && Array.isArray(parsed.questions)) return parsed.questions;
    throw new Error('Not an array');
  } catch {
    const match = cleaned.match(/\[[\s\S]+\]/);
    if (match) return JSON.parse(match[0]!);
    throw new AppError('AI trả về sai định dạng danh sách', 502, ERROR_CODES.INTERNAL_SERVER_ERROR);
  }
}

function generateShareToken(): string {
  return crypto.randomBytes(6).toString('hex');
}

export class QuizController {

  // ── 6.1.4 GET /quiz ───────────────────────────────────────────────────────
  static async listQuizzes(req: Request, res: Response, next: NextFunction) {
    try {
      const user = req.user!;
      const page  = Math.max(1, parseInt(req.query.page as string ?? '1', 10));
      const limit = Math.min(50, Math.max(1, parseInt(req.query.limit as string ?? '20', 10)));
      const offset = (page - 1) * limit;

      const { rows } = await db.query(
        `SELECT id, title, description, source_type, question_count, difficulty, is_public, share_token, play_count, created_at, updated_at
         FROM quiz_sets
         WHERE user_id = $1 AND deleted_at IS NULL
         ORDER BY created_at DESC
         LIMIT $2 OFFSET $3`,
        [user.id, limit, offset]
      );

      const countRow = await db.queryOne<{ count: string }>(
        'SELECT COUNT(*) FROM quiz_sets WHERE user_id = $1 AND deleted_at IS NULL',
        [user.id]
      );
      const total = parseInt(countRow?.count ?? '0', 10);

      return sendSuccess(res, { items: rows }, {
        pagination: { page, limit, total, total_pages: Math.ceil(total / limit) },
      });
    } catch (err) { next(err); }
  }

  // ── 6.1.2 POST /quiz/generate/text ────────────────────────────────────────
  static async generateFromText(req: Request, res: Response, next: NextFunction) {
    try {
      const user = req.user!;
      const { text, title, difficulty = 'mixed', count = 10 } = req.body;

      if (!text || text.length < 50) throw new AppError('Nội dung quá ngắn', 400, ERROR_CODES.VALIDATION_FAILED);
      if (!title) throw new AppError('Thiếu title', 400, ERROR_CODES.VALIDATION_FAILED);
      const qCount = Math.min(30, Math.max(1, parseInt(count, 10)));

      const prompt = buildQuizPrompt(text.trim(), qCount, difficulty);
      const geminiResult = await GeminiService.generate(prompt, [], {
        systemInstruction: QUIZ_SYSTEM_PROMPT,
        temperature: 0.4,
      });

      const questions = parseQuizOutput(geminiResult.text);
      await QuotaService.consumeQuota(user.id, user.plan as any, 'quiz', 'generate_text', geminiResult.tokensUsed);

      return sendSuccess(res, { 
        questions, 
        source_type: 'text',
        source_content: text,
        title: title.trim(),
        difficulty
      });
    } catch (err) { next(err); }
  }

  // ── 6.1.3 POST /quiz/generate/pdf ─────────────────────────────────────────
  static async generateFromPdf(req: Request, res: Response, next: NextFunction) {
    try {
      const user = req.user!;
      const multerFile = (req as any).file as Express.Multer.File | undefined;
      if (!multerFile) throw new AppError('File PDF là bắt buộc', 400, ERROR_CODES.VALIDATION_FAILED);

      const title = req.body.title || multerFile.originalname;
      const difficulty = req.body.difficulty || 'mixed';
      const qCount = Math.min(30, Math.max(1, parseInt(req.body.count ?? '10', 10)));

      // Upload Cloudinary
      const uploadResult = await new Promise<UploadApiResponse>((resolve, reject) => {
        const stream = cloudinary.uploader.upload_stream({ folder: `nebulalab/quiz-docs/${user.id}`, resource_type: 'raw' },
          (err: UploadApiErrorResponse | undefined, result: UploadApiResponse | undefined) => {
            if (err || !result) return reject(new Error('Upload failed'));
            resolve(result);
          });
        streamifier.createReadStream(multerFile.buffer).pipe(stream);
      });

      // Simple buffer parse (fallback)
      const rawText = multerFile.buffer.toString('utf8').replace(/[^\x20-\x7E\n\t\u00C0-\u024F]/g, ' ').trim();
      
      const prompt = buildQuizFilePrompt(rawText || title, qCount, difficulty);
      const geminiResult = await GeminiService.generate(prompt, [], {
        systemInstruction: QUIZ_SYSTEM_PROMPT,
        temperature: 0.4,
      });

      const questions = parseQuizOutput(geminiResult.text);
      await QuotaService.consumeQuota(user.id, user.plan as any, 'quiz', 'generate_pdf', geminiResult.tokensUsed);

      return sendSuccess(res, { 
        questions, 
        source_type: 'pdf',
        source_url: uploadResult.secure_url,
        title,
        difficulty
      });
    } catch (err) { next(err); }
  }

  // ── 6.1.10 POST /quiz (Final Save) ────────────────────────────────────────
  static async saveQuiz(req: Request, res: Response, next: NextFunction) {
    try {
      const user = req.user!;
      const { title, source_type, source_url, difficulty, questions } = req.body;

      if (!title) throw new AppError('Tiêu đề là bắt buộc', 400, ERROR_CODES.VALIDATION_FAILED);
      if (!questions || !Array.isArray(questions) || questions.length === 0) {
        throw new AppError('Bộ đề phải có ít nhất 1 câu hỏi', 400, ERROR_CODES.VALIDATION_FAILED);
      }

      const shareToken = generateShareToken();
      let setId: string;
      const client = await db.getClient();
      try {
        await client.query('BEGIN');
        const setRow = await client.query<{ id: string }>(
          `INSERT INTO quiz_sets (user_id, title, source_type, source_url, question_count, difficulty, share_token)
           VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
          [user.id, title, source_type, source_url || null, questions.length, difficulty, shareToken]
        );
        setId = setRow.rows[0]!.id;

        for (let i = 0; i < questions.length; i++) {
          const q = questions[i];
          await client.query(
            `INSERT INTO quiz_questions (quiz_id, question_text, question_type, options, correct_answers, explanation, sort_order)
             VALUES ($1, $2, $3, $4, $5, $6, $7)`,
            [
              setId, 
              q.question_text, 
              q.question_type || 'single_choice', 
              JSON.stringify(q.options || []), 
              JSON.stringify(q.correct_answers), 
              q.explanation || null, 
              i
            ]
          );
        }
        await client.query('COMMIT');
      } catch (err) {
        await client.query('ROLLBACK');
        throw err;
      } finally {
        client.release();
      }

      return sendSuccess(res, { quiz_id: setId, share_token: shareToken }, { message: 'Đã lưu bộ đề thành công' }, 201);
    } catch (err) { next(err); }
  }

  // ── 6.1.5 GET /quiz/share/:share_token (Public) ───────────────────────────
  static async getSharedQuiz(req: Request, res: Response, next: NextFunction) {
    try {
      const { share_token } = req.params;
      
      const quiz = await db.queryOne(
        'SELECT id, title, description, question_count, difficulty, play_count, share_token, created_at FROM quiz_sets WHERE share_token = $1 AND deleted_at IS NULL',
        [share_token]
      );
      if (!quiz) throw new AppError('Quiz không tồn tại hoặc link chia sẻ bị sai', 404, ERROR_CODES.RESOURCE_NOT_FOUND);

      const { rows: questions } = await db.query(
        'SELECT id, question_text, question_type, options, points, sort_order FROM quiz_questions WHERE quiz_id = $1 ORDER BY sort_order ASC',
        [quiz.id]
      );

      return sendSuccess(res, { quiz, questions });
    } catch (err) { next(err); }
  }

  // ── 6.1.6 PATCH /quiz/:quiz_id & 6.1.7 DELETE ─────────────────────────────
  static async deleteQuiz(req: Request, res: Response, next: NextFunction) {
    try {
      const user = req.user!;
      const { quiz_id } = req.params;
      const existing = await db.queryOne('SELECT id FROM quiz_sets WHERE id = $1 AND user_id = $2 AND deleted_at IS NULL', [quiz_id, user.id]);
      if (!existing) throw new AppError('Không tìm thấy', 404, ERROR_CODES.RESOURCE_NOT_FOUND);

      await db.query('UPDATE quiz_sets SET deleted_at = NOW() WHERE id = $1', [quiz_id]);
      return sendSuccess(res, { message: 'Đã xóa' });
    } catch (err) { next(err); }
  }

  // ── 6.1.8 POST /quiz/:quiz_id/attempt (Chấm điểm - Public) ────────────────
  static async submitAttempt(req: Request, res: Response, next: NextFunction) {
    try {
      const { quiz_id } = req.params;
      const { answers, time_spent_sec, guest_name } = req.body; // answers: Record<string, string[]> (Question_ID -> Chosen_IDs)
      const user = req.user; // optionalAuthGuard might set this

      const quiz = await db.queryOne<{ id: string; title: string }>(
        'SELECT id, title FROM quiz_sets WHERE id = $1',
        [quiz_id]
      );
      if (!quiz) throw new AppError('Bộ đề không tồn tại', 404, ERROR_CODES.RESOURCE_NOT_FOUND);

      const { rows: questions } = await db.query(
        'SELECT id, correct_answers, points, explanation, question_type FROM quiz_questions WHERE quiz_id = $1',
        [quiz_id]
      );

      let score = 0;
      let maxScore = 0;
      const details: any[] = [];

      for (const ans of answers) {
        const q = questions.find(item => item.id === ans.question_id);
        if (!q) continue;

        maxScore += q.points;
        const correctPayload = (q.correct_answers || []) as string[];
        const selectedPayload = ans.selected_options || [];

        // So sánh 2 mảng đáp án
        const sortedCorrect = [...correctPayload].sort();
        const sortedSelected = [...selectedPayload].sort();
        
        // Case-insensitive comparison for fill_blank
        let isCorrect = false;
        if (q?.question_type === 'fill_blank' && sortedCorrect.length > 0 && sortedSelected.length > 0) {
           isCorrect = (sortedCorrect[0] as string).trim().toLowerCase() === (sortedSelected[0] as string).trim().toLowerCase();
        } else {
           isCorrect = JSON.stringify(sortedCorrect) === JSON.stringify(sortedSelected);
        }

        const pointsEarned = isCorrect ? q.points : 0;
        score += pointsEarned;

        details.push({
          question_id: q.id,
          is_correct: isCorrect,
          correct_answers: correctPayload,
          selected_answers: selectedPayload,
          explanation: q.explanation,
          points_earned: pointsEarned,
          points_possible: q.points
        });
      }

      const percentage = maxScore > 0 ? (score / maxScore) * 100 : 0;

      // Lưu kết quả
      const client = await db.getClient();
      let attemptId: string;
      try {
        await client.query('BEGIN');
        const attemptRow = await client.query<{ id: string }>(
          `INSERT INTO quiz_attempts (quiz_id, user_id, guest_name, status, score, max_score, percentage, time_spent_sec, completed_at)
           VALUES ($1, $2, $3, 'completed', $4, $5, $6, $7, NOW()) RETURNING id`,
          [quiz_id, user?.id || null, guest_name || null, score, maxScore, percentage.toFixed(2), time_spent_sec || 0]
        );
        attemptId = attemptRow.rows[0]!.id;

        for (const d of details) {
          await client.query(
            `INSERT INTO quiz_answers (attempt_id, question_id, selected_answers, is_correct, points_earned)
             VALUES ($1, $2, $3, $4, $5)`,
            [attemptId, d.question_id, JSON.stringify(d.selected_answers), d.is_correct, d.points_earned]
          );
        }

        await client.query('UPDATE quiz_sets SET play_count = play_count + 1 WHERE id = $1', [quiz_id]);
        await client.query('COMMIT');
      } catch (err) {
        await client.query('ROLLBACK');
        throw err;
      } finally {
        client.release();
      }

      return sendSuccess(res, { attempt_id: attemptId, score, max_score: maxScore, percentage, details });
    } catch (err) { next(err); }
  }

  // ── 6.1.9 GET /quiz/:quiz_id/attempts (Admin views results) ───────────────
  static async getAttempts(req: Request, res: Response, next: NextFunction) {
    try {
      const user = req.user!;
      const { quiz_id } = req.params;

      // verify ownership
      const quiz = await db.queryOne('SELECT id FROM quiz_sets WHERE id = $1 AND user_id = $2', [quiz_id, user.id]);
      if (!quiz) throw new AppError('Truy cập bị từ chối', 403, ERROR_CODES.FORBIDDEN);

      const { rows } = await db.query(
        `SELECT qa.*, u.full_name as user_name 
         FROM quiz_attempts qa 
         LEFT JOIN users u ON u.id = qa.user_id 
         WHERE qa.quiz_id = $1 
         ORDER BY qa.created_at DESC`,
        [quiz_id]
      );

      return sendSuccess(res, { attempts: rows });
    } catch (err) { next(err); }
  }

  // ── 6.1.11 GET /share/:share_token/result/:attempt_id ─────────────────────
  static async getResult(req: Request, res: Response, next: NextFunction) {
    try {
      const { share_token, attempt_id } = req.params;

      const attempt = await db.queryOne<{ id: string; quiz_id: string; score: number; max_score: number; percentage: number; time_spent_sec: number; created_at: string }>(
        `SELECT id, quiz_id, score, max_score, percentage, time_spent_sec, created_at as submitted_at
         FROM quiz_attempts WHERE id = $1`,
        [attempt_id]
      );
      if (!attempt) throw new AppError('Kết quả không tồn tại', 404, ERROR_CODES.RESOURCE_NOT_FOUND);

      const quiz = await db.queryOne<{ id: string; title: string }>(
        'SELECT id, title FROM quiz_sets WHERE id = $1 AND share_token = $2',
        [attempt.quiz_id, share_token]
      );
      if (!quiz) throw new AppError('Quiz không hợp lệ', 404, ERROR_CODES.RESOURCE_NOT_FOUND);

      const { rows: details } = await db.query(
        `SELECT qa.question_id, q.question_text, qa.is_correct, qa.selected_answers as user_answer, q.correct_answers as correct_answer, q.explanation
         FROM quiz_answers qa
         JOIN quiz_questions q ON q.id = qa.question_id
         WHERE qa.attempt_id = $1
         ORDER BY q.sort_order ASC`,
        [attempt_id]
      );

      return sendSuccess(res, { attempt, quiz, details });
    } catch (err) { next(err); }
  }

}
