import { Request, Response, NextFunction } from 'express';
import { QuotaService } from '../services/quota.service.js';
import { sendSuccess } from '../utils/response.js';

export class QuotaController {
  /**
   * 2.2.4 GET /quota — Xem quota hiện tại của tất cả modules
   * Theo API_Spec.md mục 4.1
   */
  static async getMyQuota(req: Request, res: Response, next: NextFunction) {
    try {
      const user = req.user!;
      const plan = user.plan as 'free' | 'premium' | 'enterprise';

      const modules = await QuotaService.getAllQuotas(user.id, plan);

      return sendSuccess(res, {
        plan,
        modules,
      });
    } catch (err) {
      next(err);
    }
  }
}
