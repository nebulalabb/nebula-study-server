import { Request, Response, NextFunction } from 'express';
import { GeminiService } from '../services/gemini.service.js';
import { QuotaService } from '../services/quota.service.js';
import { SpacedRepetitionService, type ReviewRating } from '../services/spaced-repetition.service.js';
import { sendSuccess } from '../utils/response.js';
import { AppError, ERROR_CODES } from '../utils/AppError.js';
import {
  FLASHCARD_SYSTEM_PROMPT,
  buildFlashcardPrompt,
  buildFlashcardPdfPrompt,
} from '../utils/flashcard-prompt.js';
import cloudinary from '../utils/cloudinary.js';
import { db } from '../db/index.js';
import streamifier from 'streamifier';
import { UploadApiResponse, UploadApiErrorResponse } from 'cloudinary';

// ── Helper: parse Gemini JSON array output ───────────────────────────────────
function parseFlashcardOutput(text: string): Array<{ front: string; back: string; hint?: string }> {
  const cleaned = text.replace(/^```json\s*/i, '').replace(/\s*```$/i, '').trim();
  try {
    const parsed = JSON.parse(cleaned);
    if (Array.isArray(parsed)) return parsed;
    if (parsed.cards && Array.isArray(parsed.cards)) return parsed.cards;
    throw new Error('Output is not an array');
  } catch {
    const match = cleaned.match(/\[[\s\S]+\]/);
    if (match) return JSON.parse(match[0]!);
    throw new Error('Gemini returned non-JSON-array response');
  }
}

// ── Helper: increment card_count ─────────────────────────────────────────────
async function incrementCardCount(setId: string, delta: number) {
  await db.query(
    'UPDATE flashcard_sets SET card_count = card_count + $1 WHERE id = $2',
    [delta, setId]
  );
}

// ──────────────────────────────────────────────────────────────────────────────
export class FlashcardController {

  // ── 4.1.4 GET /flashcard/sets ──────────────────────────────────────────────
  static async listSets(req: Request, res: Response, next: NextFunction) {
    try {
      const user = req.user!;
      const page  = Math.max(1, parseInt(req.query.page  as string ?? '1',  10));
      const limit = Math.min(50, Math.max(1, parseInt(req.query.limit as string ?? '20', 10)));
      const offset = (page - 1) * limit;

      const { rows } = await db.query(
        `SELECT id, title, description, subject, source_type, card_count, is_public, created_at, updated_at
         FROM flashcard_sets
         WHERE user_id = $1 AND deleted_at IS NULL
         ORDER BY created_at DESC
         LIMIT $2 OFFSET $3`,
        [user.id, limit, offset]
      );

      const countRow = await db.queryOne<{ count: string }>(
        'SELECT COUNT(*) FROM flashcard_sets WHERE user_id = $1 AND deleted_at IS NULL',
        [user.id]
      );
      const total = parseInt(countRow?.count ?? '0', 10);

      return sendSuccess(res, { items: rows }, {
        pagination: { page, limit, total, total_pages: Math.ceil(total / limit) },
      });
    } catch (err) { next(err); }
  }

  // ── 4.1.2 POST /flashcard/sets/generate/text ──────────────────────────────
  static async generateFromText(req: Request, res: Response, next: NextFunction) {
    try {
      const user = req.user!;
      const { text, title, subject, count = 10 } = req.body;

      if (!text || typeof text !== 'string' || text.trim().length < 20) {
        throw new AppError('text phải có ít nhất 20 ký tự', 400, ERROR_CODES.VALIDATION_FAILED);
      }
      if (!title || typeof title !== 'string') {
        throw new AppError('title là bắt buộc', 400, ERROR_CODES.VALIDATION_FAILED);
      }
      const cardCount = Math.min(50, Math.max(1, parseInt(count, 10)));

      // 1. Call Gemini
      const prompt = buildFlashcardPrompt(text.trim(), cardCount, subject);
      const geminiResult = await GeminiService.generate(prompt, [], {
        systemInstruction: FLASHCARD_SYSTEM_PROMPT,
        temperature: 0.5,
        maxOutputTokens: 4096,
      });

      // 2. Parse
      let cards: Array<{ front: string; back: string; hint?: string }>;
      try {
        cards = parseFlashcardOutput(geminiResult.text);
      } catch {
        throw new AppError('AI trả về định dạng không hợp lệ. Vui lòng thử lại.', 502, ERROR_CODES.INTERNAL_SERVER_ERROR);
      }
      if (cards.length === 0) throw new AppError('AI không tạo được flashcard từ nội dung này', 422, ERROR_CODES.VALIDATION_FAILED);

      // 3. Insert set + cards in transaction
      const client = await db.getClient();
      let setId: string;
      try {
        await client.query('BEGIN');
        const setRow = await client.query<{ id: string }>(
          `INSERT INTO flashcard_sets (user_id, title, subject, source_type, card_count)
           VALUES ($1, $2, $3, 'text', $4) RETURNING id`,
          [user.id, title.trim(), subject || null, cards.length]
        );
        setId = setRow.rows[0]!.id;

        for (let i = 0; i < cards.length; i++) {
          const c = cards[i]!;
          await client.query(
            'INSERT INTO flashcards (set_id, front, back, hint, sort_order) VALUES ($1, $2, $3, $4, $5)',
            [setId, c.front, c.back, c.hint || null, i]
          );
        }
        await client.query('COMMIT');
      } catch (err) {
        await client.query('ROLLBACK');
        throw err;
      } finally {
        client.release();
      }

      // 4. Consume quota
      await QuotaService.consumeQuota(user.id, user.plan as any, 'flashcard', 'generate_text', geminiResult.tokensUsed, { set_id: setId });

      const quota = await QuotaService.checkQuota(user.id, user.plan as any, 'flashcard');

      return sendSuccess(res, { set_id: setId, card_count: cards.length, cards }, { quota_remaining: quota.remaining }, 201);
    } catch (err) { next(err); }
  }

  // ── 4.1.3 POST /flashcard/sets/generate/pdf ───────────────────────────────
  static async generateFromPdf(req: Request, res: Response, next: NextFunction) {
    try {
      const user = req.user!;
      const multerFile = (req as any).file as Express.Multer.File | undefined;
      if (!multerFile) throw new AppError('File PDF là bắt buộc', 400, ERROR_CODES.VALIDATION_FAILED);

      const { title, subject } = req.body;
      if (!title) throw new AppError('title là bắt buộc', 400, ERROR_CODES.VALIDATION_FAILED);
      const cardCount = Math.min(50, Math.max(1, parseInt(req.body.count ?? '15', 10)));

      // 1. Upload PDF to Cloudinary (for storage reference)
      const uploadResult = await new Promise<UploadApiResponse>((resolve, reject) => {
        const stream = cloudinary.uploader.upload_stream(
          { folder: `nebulalab/flashcard-pdfs/${user.id}`, resource_type: 'raw', format: 'pdf' },
          (err: UploadApiErrorResponse | undefined, result: UploadApiResponse | undefined) => {
            if (err || !result) return reject(err || new Error('Upload failed'));
            resolve(result);
          }
        );
        streamifier.createReadStream(multerFile.buffer).pipe(stream);
      });

      // 2. Extract text from PDF buffer using simple UTF-8 text extraction
      // (For production, use pdf-parse or send to Gemini directly via fileData)
      const pdfText = multerFile.buffer.toString('utf8').replace(/[^\x20-\x7E\n\t\u00C0-\u024F]/g, ' ').trim();

      // 3. Call Gemini with extracted text
      const prompt = buildFlashcardPdfPrompt(pdfText || 'Tài liệu PDF', cardCount, subject);
      const geminiResult = await GeminiService.generate(prompt, [], {
        systemInstruction: FLASHCARD_SYSTEM_PROMPT,
        temperature: 0.5,
      });

      let cards: Array<{ front: string; back: string; hint?: string }>;
      try {
        cards = parseFlashcardOutput(geminiResult.text);
      } catch {
        throw new AppError('AI trả về định dạng không hợp lệ. Vui lòng thử lại.', 502, ERROR_CODES.INTERNAL_SERVER_ERROR);
      }
      if (cards.length === 0) throw new AppError('Không thể tạo flashcard từ PDF này', 422, ERROR_CODES.VALIDATION_FAILED);

      // 4. Insert in transaction
      const client = await db.getClient();
      let setId: string;
      try {
        await client.query('BEGIN');
        const setRow = await client.query<{ id: string }>(
          `INSERT INTO flashcard_sets (user_id, title, subject, source_type, source_url, card_count)
           VALUES ($1, $2, $3, 'pdf', $4, $5) RETURNING id`,
          [user.id, title.trim(), subject || null, uploadResult.secure_url, cards.length]
        );
        setId = setRow.rows[0]!.id;

        for (let i = 0; i < cards.length; i++) {
          const c = cards[i]!;
          await client.query(
            'INSERT INTO flashcards (set_id, front, back, hint, sort_order) VALUES ($1, $2, $3, $4, $5)',
            [setId, c.front, c.back, c.hint || null, i]
          );
        }
        await client.query('COMMIT');
      } catch (err) {
        await client.query('ROLLBACK');
        throw err;
      } finally {
        client.release();
      }

      await QuotaService.consumeQuota(user.id, user.plan as any, 'flashcard', 'generate_pdf', geminiResult.tokensUsed, { set_id: setId });

      return sendSuccess(res, { set_id: setId, card_count: cards.length, cards, pdf_url: uploadResult.secure_url }, {}, 201);
    } catch (err) { next(err); }
  }

  // ── 4.1.5 GET /flashcard/sets/:set_id ─────────────────────────────────────
  static async getSet(req: Request, res: Response, next: NextFunction) {
    try {
      const user = req.user!;
      const { set_id } = req.params;

      const set = await db.queryOne(
        'SELECT * FROM flashcard_sets WHERE id = $1 AND user_id = $2 AND deleted_at IS NULL',
        [set_id, user.id]
      );
      if (!set) throw new AppError('Không tìm thấy bộ flashcard', 404, ERROR_CODES.RESOURCE_NOT_FOUND);

      const { rows: cards } = await db.query(
        'SELECT id, front, back, hint, image_url, sort_order FROM flashcards WHERE set_id = $1 ORDER BY sort_order',
        [set_id]
      );

      return sendSuccess(res, { ...set, cards });
    } catch (err) { next(err); }
  }

  // ── 4.1.6 POST /flashcard/sets — Tạo thủ công ─────────────────────────────
  static async createSet(req: Request, res: Response, next: NextFunction) {
    try {
      const user = req.user!;
      const { title, description, subject, is_public } = req.body;
      if (!title) throw new AppError('title là bắt buộc', 400, ERROR_CODES.VALIDATION_FAILED);

      const { rows } = await db.query(
        `INSERT INTO flashcard_sets (user_id, title, description, subject, source_type, is_public)
         VALUES ($1, $2, $3, $4, 'manual', $5) RETURNING *`,
        [user.id, title.trim(), description || null, subject || null, is_public ?? false]
      );

      return sendSuccess(res, rows[0], {}, 201);
    } catch (err) { next(err); }
  }

  // ── 4.1.7 POST /flashcard/sets/:set_id/cards — Thêm thẻ thủ công ──────────
  static async addCards(req: Request, res: Response, next: NextFunction) {
    try {
      const user = req.user!;
      const { set_id } = req.params;
      const { cards } = req.body; // Array of {front, back, hint?}

      const set = await db.queryOne(
        'SELECT id, card_count FROM flashcard_sets WHERE id = $1 AND user_id = $2 AND deleted_at IS NULL',
        [set_id, user.id]
      );
      if (!set) throw new AppError('Không tìm thấy bộ flashcard', 404, ERROR_CODES.RESOURCE_NOT_FOUND);

      if (!Array.isArray(cards) || cards.length === 0) {
        throw new AppError('cards phải là mảng không rỗng', 400, ERROR_CODES.VALIDATION_FAILED);
      }

      const client = await db.getClient();
      const inserted: any[] = [];
      try {
        await client.query('BEGIN');
        const countRow = await client.query<{ count: string }>(
          'SELECT COUNT(*) FROM flashcards WHERE set_id = $1', [set_id]
        );
        let sortOrder = parseInt(countRow.rows[0]!.count, 10);

        for (const c of cards) {
          const { rows } = await client.query(
            'INSERT INTO flashcards (set_id, front, back, hint, sort_order) VALUES ($1, $2, $3, $4, $5) RETURNING *',
            [set_id, c.front, c.back, c.hint || null, sortOrder++]
          );
          inserted.push(rows[0]);
        }
        await client.query(
          'UPDATE flashcard_sets SET card_count = card_count + $1 WHERE id = $2',
          [cards.length, set_id]
        );
        await client.query('COMMIT');
      } catch (err) {
        await client.query('ROLLBACK');
        throw err;
      } finally {
        client.release();
      }

      return sendSuccess(res, { added: inserted.length, cards: inserted }, {}, 201);
    } catch (err) { next(err); }
  }

  // ── 4.1.8 PATCH /flashcard/sets/:set_id ───────────────────────────────────
  static async updateSet(req: Request, res: Response, next: NextFunction) {
    try {
      const user = req.user!;
      const { set_id } = req.params;
      const { title, description, subject, is_public } = req.body;

      const existing = await db.queryOne(
        'SELECT id FROM flashcard_sets WHERE id = $1 AND user_id = $2 AND deleted_at IS NULL',
        [set_id, user.id]
      );
      if (!existing) throw new AppError('Không tìm thấy bộ flashcard', 404, ERROR_CODES.RESOURCE_NOT_FOUND);

      const setClauses: string[] = [];
      const values: any[] = [];
      let idx = 1;

      if (title !== undefined)       { setClauses.push(`title = $${idx++}`);       values.push(title); }
      if (description !== undefined) { setClauses.push(`description = $${idx++}`); values.push(description); }
      if (subject !== undefined)     { setClauses.push(`subject = $${idx++}`);     values.push(subject); }
      if (is_public !== undefined)   { setClauses.push(`is_public = $${idx++}`);   values.push(is_public); }

      if (setClauses.length === 0) return sendSuccess(res, existing);

      values.push(set_id);
      const { rows } = await db.query(
        `UPDATE flashcard_sets SET ${setClauses.join(', ')} WHERE id = $${idx} RETURNING *`,
        values
      );

      return sendSuccess(res, rows[0]);
    } catch (err) { next(err); }
  }

  // ── 4.1.8 DELETE /flashcard/sets/:set_id ──────────────────────────────────
  static async deleteSet(req: Request, res: Response, next: NextFunction) {
    try {
      const user = req.user!;
      const { set_id } = req.params;

      const existing = await db.queryOne(
        'SELECT id FROM flashcard_sets WHERE id = $1 AND user_id = $2 AND deleted_at IS NULL',
        [set_id, user.id]
      );
      if (!existing) throw new AppError('Không tìm thấy bộ flashcard', 404, ERROR_CODES.RESOURCE_NOT_FOUND);

      await db.query('UPDATE flashcard_sets SET deleted_at = NOW() WHERE id = $1', [set_id]);

      return sendSuccess(res, { message: 'Đã xoá bộ flashcard.' });
    } catch (err) { next(err); }
  }

  // ── 4.1.11 GET /flashcard/review/due ──────────────────────────────────────
  static async getDueCards(req: Request, res: Response, next: NextFunction) {
    try {
      const user = req.user!;
      const limit = Math.min(100, Math.max(1, parseInt(req.query.limit as string ?? '20', 10)));
      const set_id = req.query.set_id as string | undefined;

      const { rows } = await db.query(
        `SELECT
           rs.id AS schedule_id,
           rs.flashcard_id,
           rs.repetition,
           rs.easiness_factor,
           rs.interval_days,
           rs.next_review_at,
           rs.last_reviewed_at,
           rs.last_quality,
           f.front,
           f.back,
           f.hint,
           f.image_url,
           fs.title AS set_title,
           fs.id AS set_id
         FROM review_schedules rs
         JOIN flashcards f ON f.id = rs.flashcard_id
         JOIN flashcard_sets fs ON fs.id = f.set_id
         WHERE rs.user_id = $1
           AND rs.next_review_at <= NOW()
           AND fs.deleted_at IS NULL
           AND ($3::uuid IS NULL OR fs.id = $3::uuid)
         ORDER BY rs.next_review_at ASC
         LIMIT $2`,
        [user.id, limit, set_id || null]
      );

      return sendSuccess(res, { items: rows, count: rows.length });
    } catch (err) { next(err); }
  }

  // ── 4.1.10 POST /flashcard/review/submit ──────────────────────────────────
  static async submitReview(req: Request, res: Response, next: NextFunction) {
    try {
      const user = req.user!;
      const { card_id, rating } = req.body;

      const validRatings: ReviewRating[] = ['easy', 'medium', 'hard', 'again'];
      if (!card_id) throw new AppError('card_id là bắt buộc', 400, ERROR_CODES.VALIDATION_FAILED);
      if (!validRatings.includes(rating)) throw new AppError('rating phải là easy|medium|hard|again', 400, ERROR_CODES.VALIDATION_FAILED);

      // Validate card belongs to user (via set ownership) or review_schedule exists
      const card = await db.queryOne(
        `SELECT f.id, f.set_id FROM flashcards f
         JOIN flashcard_sets fs ON fs.id = f.set_id
         WHERE f.id = $1 AND fs.user_id = $2`,
        [card_id, user.id]
      );
      if (!card) throw new AppError('Không tìm thấy thẻ', 404, ERROR_CODES.RESOURCE_NOT_FOUND);

      // Get or create review_schedule
      let schedule = await db.queryOne(
        'SELECT * FROM review_schedules WHERE user_id = $1 AND flashcard_id = $2',
        [user.id, card_id]
      );

      const currentSchedule = {
        repetition:      schedule?.repetition        ?? 0,
        easiness_factor: parseFloat(schedule?.easiness_factor ?? '2.5'),
        interval_days:   schedule?.interval_days     ?? 1,
      };

      const next = SpacedRepetitionService.fromRating(currentSchedule, rating as ReviewRating);

      if (schedule) {
        await db.query(
          `UPDATE review_schedules
           SET repetition = $1, easiness_factor = $2, interval_days = $3,
               next_review_at = $4, last_reviewed_at = NOW(), last_quality = $5
           WHERE id = $6`,
          [next.repetition, next.easiness_factor, next.interval_days, next.next_review_at, next.quality, schedule.id]
        );
      } else {
        await db.query(
          `INSERT INTO review_schedules
             (user_id, flashcard_id, repetition, easiness_factor, interval_days, next_review_at, last_reviewed_at, last_quality)
           VALUES ($1, $2, $3, $4, $5, $6, NOW(), $7)`,
          [user.id, card_id, next.repetition, next.easiness_factor, next.interval_days, next.next_review_at, next.quality]
        );
      }

      return sendSuccess(res, {
        card_id,
        rating,
        quality: next.quality,
        next_review_at: next.next_review_at,
        interval_days: next.interval_days,
        repetition: next.repetition,
      });
    } catch (err) { next(err); }
  }
}
