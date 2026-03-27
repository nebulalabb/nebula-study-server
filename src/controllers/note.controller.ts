import { Request, Response, NextFunction } from 'express';
import { GeminiService } from '../services/gemini.service.js';
import { QuotaService } from '../services/quota.service.js';
import { sendSuccess } from '../utils/response.js';
import { AppError, ERROR_CODES } from '../utils/AppError.js';
import {
  NOTE_SYSTEM_PROMPT,
  buildNotePrompt,
  buildNoteFilePrompt,
} from '../utils/note-prompt.js';
import cloudinary from '../utils/cloudinary.js';
import { db } from '../db/index.js';
import streamifier from 'streamifier';
import { UploadApiResponse, UploadApiErrorResponse } from 'cloudinary';

// ── Helper: parse Gemini JSON object ─────────────────────────────────────────
function parseNoteOutput(text: string): { short_summary: string; bullet_points: string[]; keywords: string[] } {
  const cleaned = text.replace(/^```json\s*/i, '').replace(/\s*```$/i, '').trim();
  try {
    const parsed = JSON.parse(cleaned);
    if (parsed.short_summary && Array.isArray(parsed.bullet_points) && Array.isArray(parsed.keywords)) {
      return parsed;
    }
    throw new Error('Invalid structure');
  } catch {
    throw new Error('Gemini returned non-JSON-object response');
  }
}

export class NoteController {

  // ── 5.1.4 GET /note ───────────────────────────────────────────────────────
  static async listNotes(req: Request, res: Response, next: NextFunction) {
    try {
      const user = req.user!;
      const page  = Math.max(1, parseInt(req.query.page  as string ?? '1',  10));
      const limit = Math.min(50, Math.max(1, parseInt(req.query.limit as string ?? '20', 10)));
      const offset = (page - 1) * limit;

      const keyword = typeof req.query.q === 'string' ? req.query.q : null;
      const tag = typeof req.query.tag === 'string' ? req.query.tag : null;

      const whereClauses = ['user_id = $1', 'deleted_at IS NULL'];
      const values: any[] = [user.id];
      let idx = 2;

      if (keyword) {
        whereClauses.push(`title ILIKE $${idx++}`);
        values.push(`%${keyword}%`);
      }
      if (tag) {
        whereClauses.push(`$${idx++} = ANY(tags)`);
        values.push(tag);
      }

      const whereStr = whereClauses.join(' AND ');

      const { rows } = await db.query(
        `SELECT id, title, source_type, word_count, tags, is_pinned, created_at, updated_at
         FROM notes
         WHERE ${whereStr}
         ORDER BY is_pinned DESC, created_at DESC
         LIMIT $${idx} OFFSET $${idx + 1}`,
        [...values, limit, offset]
      );

      const countRow = await db.query<{ count: string }>(
        `SELECT COUNT(*) FROM notes WHERE ${whereStr}`,
        values
      );
      const total = parseInt(countRow.rows[0]?.count ?? '0', 10);

      return sendSuccess(res, { items: rows }, {
        pagination: { page, limit, total, total_pages: Math.ceil(total / limit) },
      });
    } catch (err) { next(err); }
  }

  // ── 5.1.2 POST /note/summarize ────────────────────────────────────────────
  static async summarizeText(req: Request, res: Response, next: NextFunction) {
    try {
      const user = req.user!;
      const { text, title, tags = [] } = req.body;

      if (!text || typeof text !== 'string' || text.trim().length < 50) {
        throw new AppError('text phải có ít nhất 50 ký tự để tóm tắt', 400, ERROR_CODES.VALIDATION_FAILED);
      }
      const noteTitle = title || 'Ghi chú văn bản';

      // 1. Call Gemini
      const prompt = buildNotePrompt(text.trim());
      const geminiResult = await GeminiService.generate(prompt, [], {
        systemInstruction: NOTE_SYSTEM_PROMPT,
        temperature: 0.3,
      });

      // 2. Parse result
      let summaryData;
      try {
        summaryData = parseNoteOutput(geminiResult.text);
      } catch {
        throw new AppError('AI trả về định dạng không hợp lệ. Vui lòng thử lại.', 502, ERROR_CODES.INTERNAL_SERVER_ERROR);
      }

      const wordCount = text.trim().split(/\s+/).length;
      const finalTags = Array.isArray(tags) && tags.length > 0 ? tags : summaryData.keywords.slice(0, 3);

      // 3. Insert specific Note & Summary in transaction
      const client = await db.getClient();
      let noteId: string;
      try {
        await client.query('BEGIN');
        
        const noteRow = await client.query<{ id: string }>(
          `INSERT INTO notes (user_id, title, source_type, source_content, word_count, tags)
           VALUES ($1, $2, 'text', $3, $4, $5) RETURNING id`,
          [user.id, noteTitle, text.trim(), wordCount, finalTags]
        );
        noteId = noteRow.rows[0]!.id;

        await client.query(
          `INSERT INTO note_summaries (note_id, summary_short, bullet_points, keywords, tokens_used)
           VALUES ($1, $2, $3, $4, $5)`,
          [noteId, summaryData.short_summary, JSON.stringify(summaryData.bullet_points), summaryData.keywords, geminiResult.tokensUsed]
        );

        await client.query('COMMIT');
      } catch (err) {
        await client.query('ROLLBACK');
        throw err;
      } finally {
        client.release();
      }

      await QuotaService.consumeQuota(user.id, user.plan as any, 'note', 'summarize_text', geminiResult.tokensUsed, { note_id: noteId });
      const quota = await QuotaService.checkQuota(user.id, user.plan as any, 'note');

      return sendSuccess(res, { note_id: noteId, ...summaryData }, { quota_remaining: quota.remaining }, 201);
    } catch (err) { next(err); }
  }

  // ── 5.1.3 POST /note/summarize/file ───────────────────────────────────────
  static async summarizeFile(req: Request, res: Response, next: NextFunction) {
    try {
      const user = req.user!;
      const multerFile = (req as any).file as Express.Multer.File | undefined;
      if (!multerFile) throw new AppError('File là bắt buộc', 400, ERROR_CODES.VALIDATION_FAILED);

      const title = req.body.title || multerFile.originalname || 'Ghi chú tài liệu';
      const tags = req.body.tags ? JSON.parse(req.body.tags) : [];

      // 1. Upload to Cloudinary
      const uploadResult = await new Promise<UploadApiResponse>((resolve, reject) => {
        const stream = cloudinary.uploader.upload_stream(
          { folder: `nebulalab/notes-docs/${user.id}`, resource_type: 'raw' },
          (err: UploadApiErrorResponse | undefined, result: UploadApiResponse | undefined) => {
            if (err || !result) return reject(err || new Error('Upload failed'));
            resolve(result);
          }
        );
        streamifier.createReadStream(multerFile.buffer).pipe(stream);
      });

      // 2. Read Text (Fallback to raw string)
      const rawText = multerFile.buffer.toString('utf8').replace(/[^\x20-\x7E\n\t\u00C0-\u024F]/g, ' ').trim();
      if (rawText.length < 50) {
        throw new AppError('Không thể trích xuất văn bản hợp lệ từ file này', 422, ERROR_CODES.VALIDATION_FAILED);
      }

      // 3. Call Gemini
      const prompt = buildNoteFilePrompt(rawText);
      const geminiResult = await GeminiService.generate(prompt, [], {
        systemInstruction: NOTE_SYSTEM_PROMPT,
        temperature: 0.3,
      });

      let summaryData;
      try {
        summaryData = parseNoteOutput(geminiResult.text);
      } catch {
        throw new AppError('AI trả về định dạng không hợp lệ.', 502, ERROR_CODES.INTERNAL_SERVER_ERROR);
      }

      const wordCount = rawText.split(/\s+/).length;
      const finalTags = Array.isArray(tags) && tags.length > 0 ? tags : summaryData.keywords.slice(0, 3);
      const sourceType = multerFile.mimetype.includes('pdf') ? 'pdf' : 'docx';

      // 4. Save
      const client = await db.getClient();
      let noteId: string;
      try {
        await client.query('BEGIN');
        
        const noteRow = await client.query<{ id: string }>(
          `INSERT INTO notes (user_id, title, source_type, source_url, word_count, tags)
           VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
          [user.id, title, sourceType, uploadResult.secure_url, wordCount, finalTags]
        );
        noteId = noteRow.rows[0]!.id;

        await client.query(
          `INSERT INTO note_summaries (note_id, summary_short, bullet_points, keywords, tokens_used)
           VALUES ($1, $2, $3, $4, $5)`,
          [noteId, summaryData.short_summary, JSON.stringify(summaryData.bullet_points), summaryData.keywords, geminiResult.tokensUsed]
        );

        await client.query('COMMIT');
      } catch (err) {
        await client.query('ROLLBACK');
        throw err;
      } finally {
        client.release();
      }

      await QuotaService.consumeQuota(user.id, user.plan as any, 'note', 'summarize_file', geminiResult.tokensUsed, { note_id: noteId });

      return sendSuccess(res, { note_id: noteId, file_url: uploadResult.secure_url, ...summaryData }, {}, 201);
    } catch (err) { next(err); }
  }

  // ── 5.1.5 GET /note/:note_id ──────────────────────────────────────────────
  static async getNote(req: Request, res: Response, next: NextFunction) {
    try {
      const user = req.user!;
      const { note_id } = req.params;

      const note = await db.queryOne(
        'SELECT * FROM notes WHERE id = $1 AND user_id = $2 AND deleted_at IS NULL',
        [note_id, user.id]
      );
      if (!note) throw new AppError('Không tìm thấy ghi chú', 404, ERROR_CODES.RESOURCE_NOT_FOUND);

      const summary = await db.queryOne(
        'SELECT summary_short, bullet_points, keywords, full_summary FROM note_summaries WHERE note_id = $1',
        [note_id]
      );

      return sendSuccess(res, { ...note, summary });
    } catch (err) { next(err); }
  }

  // ── 5.1.6 PATCH /note/:note_id ────────────────────────────────────────────
  static async updateNote(req: Request, res: Response, next: NextFunction) {
    try {
      const user = req.user!;
      const { note_id } = req.params;
      const { title, tags, is_pinned } = req.body;

      const existing = await db.queryOne('SELECT id FROM notes WHERE id = $1 AND user_id = $2', [note_id, user.id]);
      if (!existing) throw new AppError('Không tìm thấy ghi chú', 404, ERROR_CODES.RESOURCE_NOT_FOUND);

      const clauses: string[] = [];
      const values: any[] = [];
      let idx = 1;

      if (title !== undefined) { clauses.push(`title = $${idx++}`); values.push(title); }
      if (tags !== undefined) { clauses.push(`tags = $${idx++}`); values.push(tags); }
      if (is_pinned !== undefined) { clauses.push(`is_pinned = $${idx++}`); values.push(is_pinned); }

      if (clauses.length === 0) return sendSuccess(res, existing);

      values.push(note_id);
      const { rows } = await db.query(
        `UPDATE notes SET ${clauses.join(', ')} WHERE id = $${idx} RETURNING *`,
        values
      );

      return sendSuccess(res, rows[0]);
    } catch (err) { next(err); }
  }

  // ── 5.1.7 DELETE /note/:note_id ───────────────────────────────────────────
  static async deleteNote(req: Request, res: Response, next: NextFunction) {
    try {
      const user = req.user!;
      const { note_id } = req.params;

      const existing = await db.queryOne('SELECT id FROM notes WHERE id = $1 AND user_id = $2', [note_id, user.id]);
      if (!existing) throw new AppError('Không tìm thấy ghi chú', 404, ERROR_CODES.RESOURCE_NOT_FOUND);

      await db.query('UPDATE notes SET deleted_at = NOW() WHERE id = $1', [note_id]);
      return sendSuccess(res, { message: 'Đã xóa ghi chú' });
    } catch (err) { next(err); }
  }
}
