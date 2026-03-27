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
function parseNoteOutput(text: string): { summary: string; bullet_points: string[]; keywords: { term: string; explanation: string }[] } {
  const cleaned = text.replace(/^```json\s*/i, '').replace(/\s*```$/i, '').trim();
  try {
    const parsed = JSON.parse(cleaned);
    if (parsed.summary && Array.isArray(parsed.bullet_points) && Array.isArray(parsed.keywords)) {
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

  // ── 5.1.5 GET /note/:note_id ─────────────────────────────────────────────
  static async getNote(req: Request, res: Response, next: NextFunction) {
    try {
      const user = req.user!;
      const { note_id } = req.params;

      const { rows } = await db.query(
        `SELECT n.*, s.summary_short as "summary_text", s.bullet_points, s.keywords
         FROM notes n
         JOIN note_summaries s ON n.id = s.note_id
         WHERE n.id = $1 AND n.user_id = $2 AND n.deleted_at IS NULL
         ORDER BY s.created_at DESC
         LIMIT 1`,
        [note_id, user.id]
      );

      if (rows.length === 0) throw new AppError('Không tìm thấy ghi chú', 404, ERROR_CODES.RESOURCE_NOT_FOUND);

      const note = rows[0];
      return sendSuccess(res, {
        ...note,
        summary: {
          summary: note.summary_text,
          bullet_points: note.bullet_points,
          keywords: note.keywords
        }
      });
    } catch (err) { next(err); }
  }

  // ── 5.1.2 POST /note/summarize ──────────────────────────────────────────── (Preview Only)
  static async summarizeText(req: Request, res: Response, next: NextFunction) {
    try {
      const user = req.user!;
      const { text, subject } = req.body;

      if (!text || typeof text !== 'string' || text.trim().length < 50) {
        throw new AppError('text phải có ít nhất 50 ký tự để tóm tắt', 400, ERROR_CODES.VALIDATION_FAILED);
      }

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

      await QuotaService.consumeQuota(user.id, user.plan as any, 'note', 'summarize_text', geminiResult.tokensUsed, { is_preview: true });

      return sendSuccess(res, { ...summaryData, word_count: text.trim().split(/\s+/).length });
    } catch (err) { next(err); }
  }

  // ── 5.1.3 POST /note/summarize/file ─────────────────────────────────────── (Preview Only)
  static async summarizeFile(req: Request, res: Response, next: NextFunction) {
    try {
      const user = req.user!;
      const multerFile = (req as any).file as Express.Multer.File | undefined;
      if (!multerFile) throw new AppError('File là bắt buộc', 400, ERROR_CODES.VALIDATION_FAILED);

      const mimeType = multerFile.mimetype as any;
      const isPdf = multerFile.mimetype.includes('pdf');
      const isDocx = multerFile.mimetype.includes('wordprocessingml');

      // 1. Upload metadata to Cloudinary (for future storage reference)
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

      // 2. Call Gemini directly with binary buffer (base64)
      const prompt = buildNoteFilePrompt('Tài liệu đính kèm');
      const geminiResult = await GeminiService.generate(prompt, [
        { type: 'document', mimeType, data: multerFile.buffer.toString('base64') }
      ], {
        systemInstruction: NOTE_SYSTEM_PROMPT,
        temperature: 0.3,
      });

      let summaryData;
      try {
        summaryData = parseNoteOutput(geminiResult.text);
      } catch {
        throw new AppError('AI trả về định dạng không hợp lệ.', 502, ERROR_CODES.INTERNAL_SERVER_ERROR);
      }

      await QuotaService.consumeQuota(user.id, user.plan as any, 'note', 'summarize_file', geminiResult.tokensUsed, { is_preview: true });

      return sendSuccess(res, { 
        ...summaryData, 
        source_url: uploadResult.secure_url, 
        source_type: isPdf ? 'pdf' : 'docx',
        source_filename: multerFile.originalname
      });
    } catch (err) { next(err); }
  }


  // ── 5.1.8 POST /note — Final Save ──────────────────────────────────────────
  static async saveNote(req: Request, res: Response, next: NextFunction) {
    try {
      const user = req.user!;
      const { 
        title, 
        source_type, 
        source_url, 
        source_filename, 
        source_content, 
        summary, 
        bullet_points, 
        keywords, 
        tags = [] 
      } = req.body;

      if (!title) throw new AppError('Tiêu đề là bắt buộc', 400, ERROR_CODES.VALIDATION_FAILED);

      const client = await db.getClient();
      let noteId: string;
      try {
        await client.query('BEGIN');

        const noteRow = await client.query<{ id: string }>(
          `INSERT INTO notes (user_id, title, source_type, source_url, source_filename, source_content, tags)
           VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
          [user.id, title, source_type, source_url || null, source_filename || null, source_content || null, tags]
        );
        noteId = noteRow.rows[0]!.id;

        await client.query(
          `INSERT INTO note_summaries (note_id, summary_short, bullet_points, keywords)
           VALUES ($1, $2, $3, $4)`,
          [noteId, summary, JSON.stringify(bullet_points), JSON.stringify(keywords)]
        );

        await client.query('COMMIT');
      } catch (err) {
        await client.query('ROLLBACK');
        throw err;
      } finally {
        client.release();
      }

      return sendSuccess(res, { note_id: noteId }, {}, 201);
    } catch (err) { next(err); }
  }

  // ── 5.1.9 GET /note/search ────────────────────────────────────────────────
  static async searchNotes(req: Request, res: Response, next: NextFunction) {
    try {
      const user = req.user!;
      const q = typeof req.query.q === 'string' ? req.query.q : '';
      if (!q) return sendSuccess(res, { items: [] });

      const { rows } = await db.query(
        `SELECT n.id, n.title, n.source_type, n.tags, s.summary_short as "summary", n.created_at,
                ts_rank(to_tsvector('simple', n.title), to_tsquery('simple', $2)) +
                ts_rank(to_tsvector('simple', s.summary_short), to_tsquery('simple', $2)) as rank
         FROM notes n
         JOIN note_summaries s ON n.id = s.note_id
         WHERE n.user_id = $1 AND n.deleted_at IS NULL
           AND (to_tsvector('simple', n.title) @@ to_tsquery('simple', $2)
             OR to_tsvector('simple', s.summary_short) @@ to_tsquery('simple', $2))
         ORDER BY rank DESC
         LIMIT 20`,
        [user.id, q.trim().split(/\s+/).join(' & ')]
      );

      return sendSuccess(res, { items: rows });
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
