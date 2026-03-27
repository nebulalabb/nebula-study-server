import { Request, Response, NextFunction } from 'express';
import { QuotaService } from '../services/quota.service.js';
import { sendError } from '../utils/response.js';
import { ERROR_CODES } from '../utils/AppError.js';

/**
 * 2.2.3 — Middleware: quotaGuard(module)
 * Checks the user's quota for a given AI module BEFORE processing the request.
 * If quota exceeded, returns 429 QUOTA_EXCEEDED with full details as per Flow_Design.md section 4.
 *
 * Usage: router.post('/solver/solve', authGuard, quotaGuard('solver'), SolverController.solve)
 */
export const quotaGuard = (module: string) => {
  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      if (!req.user) {
        return next(); // authGuard should handle this before us
      }

      const userId = req.user.id;
      const userPlan = req.user.plan as 'free' | 'premium' | 'enterprise';

      const quota = await QuotaService.checkQuota(userId, userPlan, module);

      if (!quota.allowed) {
        return sendError(
          res,
          ERROR_CODES.QUOTA_EXCEEDED,
          `Bạn đã dùng hết ${quota.limit} lượt ${module} hôm nay`,
          429,
          {
            module,
            limit: quota.limit,
            used: quota.used,
            reset_at: quota.reset_at,
            reset_type: quota.reset_type,
            upgrade_url: '/billing/upgrade',
          }
        );
      }

      // Attach quota info to request for downstream use
      (req as any).quotaInfo = quota;

      next();
    } catch (err) {
      next(err);
    }
  };
};
