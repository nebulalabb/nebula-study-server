import { Request, Response, NextFunction } from 'express';
import { GeminiService } from '../services/gemini.service.js';
import { QuotaService } from '../services/quota.service.js';
import { sendSuccess, sendError } from '../utils/response.js';
import { AppError, ERROR_CODES } from '../utils/AppError.js';
import { SOLVER_SYSTEM_PROMPT, buildSolverPrompt, buildSolverImagePrompt } from '../utils/solver-prompt.js';
import cloudinary from '../utils/cloudinary.js';
import { db } from '../db/index.js';
import streamifier from 'streamifier';
import { UploadApiResponse, UploadApiErrorResponse } from 'cloudinary';

// ── Helper: parse Gemini JSON output safely ──────────────────────────────────
function parseSolverOutput(text: string) {
  // Strip any markdown code fences if model wraps the JSON
  const cleaned = text.replace(/^```json\s*/i, '').replace(/\s*```$/i, '').trim();
  try {
    return JSON.parse(cleaned);
  } catch {
    // If still failing, try to extract JSON block
    const match = cleaned.match(/\{[\s\S]+\}/);
    if (match) return JSON.parse(match[0]!);
    throw new Error('Gemini returned non-JSON response');
  }
}

export class SolverController {

  /**
   * 3.1.4 — POST /solver/solve (text input)
   * authGuard + quotaGuard('solver') applied in routes
   * Theo API_Spec.md mục 6.1 + Flow_Design.md mục 6
   */
  static async solveText(req: Request, res: Response, next: NextFunction) {
    const startMs = Date.now();
    try {
      const user = req.user!;
      const { question_text, subject } = req.body;

      if (!question_text || typeof question_text !== 'string' || question_text.trim().length < 5) {
        throw new AppError('question_text phải có ít nhất 5 ký tự', 400, ERROR_CODES.VALIDATION_FAILED);
      }
      if (question_text.length > 5000) {
        throw new AppError('question_text không được vượt quá 5000 ký tự', 400, ERROR_CODES.VALIDATION_FAILED);
      }

      // 1. Build prompt and call Gemini
      const userPrompt = buildSolverPrompt(question_text.trim(), subject);
      const geminiResult = await GeminiService.generate(userPrompt, [], {
        systemInstruction: SOLVER_SYSTEM_PROMPT,
        temperature: 0.3,
        maxOutputTokens: 8192,
      });

      // 2. Parse structured output
      let parsed: any;
      try {
        parsed = parseSolverOutput(geminiResult.text);
      } catch {
        throw new AppError('AI trả về định dạng không hợp lệ. Vui lòng thử lại.', 502, ERROR_CODES.INTERNAL_SERVER_ERROR);
      }

      const solveTimeMs = Date.now() - startMs;

      // 3. Persist to solve_histories
      const { rows } = await db.query(
        `INSERT INTO solve_histories
           (user_id, subject, question_text, input_type, solution, steps, explanation, confidence, tokens_used, model_version, solve_time_ms)
         VALUES ($1, $2, $3, 'text', $4, $5, $6, $7, $8, $9, $10)
         RETURNING id, created_at`,
        [
          user.id,
          parsed.subject ?? subject ?? 'general',
          question_text.trim(),
          parsed.solution ?? '',
          JSON.stringify(parsed.steps ?? []),
          parsed.explanation ?? '',
          parsed.confidence ?? null,
          geminiResult.tokensUsed,
          geminiResult.modelVersion,
          solveTimeMs,
        ]
      );
      const history = rows[0]!;

      // 4. Consume quota
      await QuotaService.consumeQuota(user.id, user.plan as any, 'solver', 'solve_text', geminiResult.tokensUsed, {
        history_id: history.id,
        subject: parsed.subject ?? 'general',
      });

      // 5. Return quota meta
      const quota = await QuotaService.checkQuota(user.id, user.plan as any, 'solver');

      return sendSuccess(
        res,
        {
          id: history.id,
          subject: parsed.subject ?? 'general',
          question_text: question_text.trim(),
          steps: parsed.steps ?? [],
          solution: parsed.solution ?? '',
          explanation: parsed.explanation ?? '',
          confidence: parsed.confidence ?? null,
          tokens_used: geminiResult.tokensUsed,
          solve_time_ms: solveTimeMs,
          created_at: history.created_at,
        },
        {
          quota_remaining: quota.remaining,
          quota_reset_at: quota.reset_at,
        }
      );
    } catch (err) {
      next(err);
    }
  }

  /**
   * 3.1.5 — POST /solver/solve/image (image input)
   * Upload ảnh → Cloudinary → Gemini multimodal
   * Theo API_Spec.md mục 6.2
   */
  static async solveImage(req: Request, res: Response, next: NextFunction) {
    const startMs = Date.now();
    try {
      const user = req.user!;
      const multerFile = (req as any).file as Express.Multer.File | undefined;

      if (!multerFile) {
        throw new AppError('File ảnh là bắt buộc', 400, ERROR_CODES.VALIDATION_FAILED);
      }

      const additionalContext = req.body.context as string | undefined;
      const subject = req.body.subject as string | undefined;

      // 1. Upload image to Cloudinary
      const uploadResult = await new Promise<UploadApiResponse>((resolve, reject) => {
        const stream = cloudinary.uploader.upload_stream(
          { folder: `nebulalab/solver/${user.id}`, resource_type: 'image' },
          (err: UploadApiErrorResponse | undefined, result: UploadApiResponse | undefined) => {
            if (err || !result) return reject(err || new Error('Upload failed'));
            resolve(result);
          }
        );
        streamifier.createReadStream(multerFile.buffer).pipe(stream);
      });
      const imageUrl = uploadResult.secure_url;

      // 2. Call Gemini with image URL
      const userPrompt = buildSolverImagePrompt(additionalContext);
      const geminiResult = await GeminiService.generateWithImageUrl(
        userPrompt,
        imageUrl,
        'image/jpeg',
        {
          systemInstruction: SOLVER_SYSTEM_PROMPT,
          temperature: 0.3,
        }
      );

      // 3. Parse output
      let parsed: any;
      try {
        parsed = parseSolverOutput(geminiResult.text);
      } catch {
        throw new AppError('AI trả về định dạng không hợp lệ. Vui lòng thử lại.', 502, ERROR_CODES.INTERNAL_SERVER_ERROR);
      }

      const solveTimeMs = Date.now() - startMs;

      // 4. Save to DB
      const { rows } = await db.query(
        `INSERT INTO solve_histories
           (user_id, subject, question_image_url, input_type, solution, steps, explanation, confidence, tokens_used, model_version, solve_time_ms)
         VALUES ($1, $2, $3, 'image', $4, $5, $6, $7, $8, $9, $10)
         RETURNING id, created_at`,
        [
          user.id,
          parsed.subject ?? subject ?? 'general',
          imageUrl,
          parsed.solution ?? '',
          JSON.stringify(parsed.steps ?? []),
          parsed.explanation ?? '',
          parsed.confidence ?? null,
          geminiResult.tokensUsed,
          geminiResult.modelVersion,
          solveTimeMs,
        ]
      );
      const history = rows[0]!;

      // 5. Consume quota
      await QuotaService.consumeQuota(user.id, user.plan as any, 'solver', 'solve_image', geminiResult.tokensUsed, {
        history_id: history.id,
      });

      const quota = await QuotaService.checkQuota(user.id, user.plan as any, 'solver');

      return sendSuccess(
        res,
        {
          id: history.id,
          subject: parsed.subject ?? 'general',
          question_image_url: imageUrl,
          steps: parsed.steps ?? [],
          solution: parsed.solution ?? '',
          explanation: parsed.explanation ?? '',
          confidence: parsed.confidence ?? null,
          tokens_used: geminiResult.tokensUsed,
          solve_time_ms: solveTimeMs,
          created_at: history.created_at,
        },
        {
          quota_remaining: quota.remaining,
          quota_reset_at: quota.reset_at,
        }
      );
    } catch (err) {
      next(err);
    }
  }

  /**
   * 3.1.6 — GET /solver/history
   * Pagination + filter by subject
   * Theo API_Spec.md mục 6.3
   */
  static async getHistory(req: Request, res: Response, next: NextFunction) {
    try {
      const user = req.user!;
      const page  = Math.max(1, parseInt(req.query.page  as string ?? '1',  10));
      const limit = Math.min(50, Math.max(1, parseInt(req.query.limit as string ?? '20', 10)));
      const subject = req.query.subject as string | undefined;
      const offset = (page - 1) * limit;

      const { rows, rowCount } = await db.query(
        `SELECT id, subject, question_text, question_image_url, input_type,
                solution, steps, explanation, confidence, tokens_used, solve_time_ms, created_at
         FROM solve_histories
         WHERE user_id = $1
           AND deleted_at IS NULL
           AND ($4::text IS NULL OR subject = $4)
         ORDER BY created_at DESC
         LIMIT $2 OFFSET $3`,
        [user.id, limit, offset, subject || null]
      );

      const totalCount = rowCount ?? 0;

      return sendSuccess(res, { items: rows }, {
        pagination: {
          page,
          limit,
          total: totalCount,
          total_pages: Math.ceil(totalCount / limit),
        },
      });
    } catch (err) {
      next(err);
    }
  }

  /**
   * 3.1.7 — DELETE /solver/history/:id
   * Soft delete
   * Theo API_Spec.md mục 6.4
   */
  static async deleteHistory(req: Request, res: Response, next: NextFunction) {
    try {
      const user = req.user!;
      const { id } = req.params;

      const existing = await db.queryOne(
        'SELECT id FROM solve_histories WHERE id = $1 AND user_id = $2 AND deleted_at IS NULL',
        [id, user.id]
      );

      if (!existing) {
        throw new AppError('Không tìm thấy lịch sử giải bài', 404, ERROR_CODES.RESOURCE_NOT_FOUND);
      }

      await db.query(
        'UPDATE solve_histories SET deleted_at = NOW() WHERE id = $1',
        [id]
      );

      return sendSuccess(res, { message: 'Đã xoá lịch sử giải bài.' });
    } catch (err) {
      next(err);
    }
  }
}
