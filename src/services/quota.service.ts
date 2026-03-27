import { db } from '../db/index.js';
import cache from '../utils/cache.js';
import { GamificationService } from './gamification.service.js';

/**
 * Quota limits per plan per module — matches API_Spec.md Section 16
 * -1 = unlimited
 */
const QUOTA_CONFIG: Record<string, Record<string, { limit: number; resetType: 'daily' | 'monthly' }>> = {
  free: {
    solver:    { limit: 5,  resetType: 'daily' },
    flashcard: { limit: 20, resetType: 'monthly' },
    note:      { limit: 3,  resetType: 'daily' },
    quiz:      { limit: 1,  resetType: 'daily' },
    exam:      { limit: 3,  resetType: 'monthly' },
    microlearn:{ limit: -1, resetType: 'daily' }, // unlimited for micro-learning
  },
  premium: {
    solver:    { limit: -1, resetType: 'daily' },
    flashcard: { limit: -1, resetType: 'monthly' },
    note:      { limit: -1, resetType: 'daily' },
    quiz:      { limit: -1, resetType: 'daily' },
    exam:      { limit: -1, resetType: 'monthly' },
    microlearn:{ limit: -1, resetType: 'daily' },
  },
  enterprise: {
    solver:    { limit: -1, resetType: 'daily' },
    flashcard: { limit: -1, resetType: 'monthly' },
    note:      { limit: -1, resetType: 'daily' },
    quiz:      { limit: -1, resetType: 'daily' },
    exam:      { limit: -1, resetType: 'monthly' },
    microlearn:{ limit: -1, resetType: 'daily' },
  },
};

export interface QuotaCheckResult {
  allowed: boolean;
  used: number;
  limit: number;
  remaining: number;
  reset_at: string;
  reset_type: 'daily' | 'monthly';
}

export class QuotaService {
  /**
   * Get the start of the current day (UTC midnight)
   */
  private static getDayStart(): Date {
    const now = new Date();
    return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  }

  /**
   * Get the start of the next day (UTC midnight)
   */
  private static getNextDayStart(): Date {
    const d = QuotaService.getDayStart();
    d.setUTCDate(d.getUTCDate() + 1);
    return d;
  }

  /**
   * Get the start of the next month (UTC)
   */
  private static getNextMonthStart(): Date {
    const now = new Date();
    return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
  }

  /**
   * Get the start of the current month (UTC)
   */
  private static getMonthStart(): Date {
    const now = new Date();
    return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  }

  /**
   * Count current usage from DB (or in-memory cache).
   */
  private static async getUsageCount(
    userId: string,
    module: string,
    resetType: 'daily' | 'monthly'
  ): Promise<number> {
    const cacheKey = `quota:${userId}:${module}:${resetType === 'daily' ? QuotaService.getDayStart().toISOString().slice(0, 10) : QuotaService.getMonthStart().toISOString().slice(0, 7)}`;

    // 1. Try in-memory cache
    const cached = await cache.get<number>(cacheKey);
    if (cached !== null) {
      return cached;
    }

    // 2. Query DB
    const periodStart = resetType === 'daily' ? QuotaService.getDayStart() : QuotaService.getMonthStart();
    const result = await db.queryOne<{ count: string }>(
      `SELECT COUNT(*) as count FROM usage_logs WHERE user_id = $1 AND module = $2 AND created_at >= $3`,
      [userId, module, periodStart]
    );
    const count = parseInt(result?.count ?? '0', 10);

    // 3. Cache until period reset
    const resetAt = resetType === 'daily' ? QuotaService.getNextDayStart() : QuotaService.getNextMonthStart();
    const ttlSeconds = Math.max(1, Math.floor((resetAt.getTime() - Date.now()) / 1000));
    await cache.set(cacheKey, count, ttlSeconds);

    return count;
  }

  /**
   * 2.2.1 — Check if user is allowed to use a module
   */
  static async checkQuota(
    userId: string,
    userPlan: 'free' | 'premium' | 'enterprise',
    module: string
  ): Promise<QuotaCheckResult> {
    const planConfig = QUOTA_CONFIG[userPlan] ?? QUOTA_CONFIG['free']!;
    const moduleConfig = planConfig[module];

    if (!moduleConfig) {
      // Unknown module — allow by default
      return { allowed: true, used: 0, limit: -1, remaining: -1, reset_at: '', reset_type: 'daily' };
    }

    const { limit, resetType } = moduleConfig;

    // Unlimited
    if (limit === -1) {
      return {
        allowed: true,
        used: 0,
        limit: -1,
        remaining: -1,
        reset_at: resetType === 'daily'
          ? QuotaService.getNextDayStart().toISOString()
          : QuotaService.getNextMonthStart().toISOString(),
        reset_type: resetType,
      };
    }

    const used = await QuotaService.getUsageCount(userId, module, resetType);
    const remaining = Math.max(0, limit - used);
    const reset_at = resetType === 'daily'
      ? QuotaService.getNextDayStart().toISOString()
      : QuotaService.getNextMonthStart().toISOString();

    return {
      allowed: used < limit,
      used,
      limit,
      remaining,
      reset_at,
      reset_type: resetType,
    };
  }

  /**
   * 2.2.2 — Record usage after successful AI call and increment cache counter
   */
  static async consumeQuota(
    userId: string,
    userPlan: 'free' | 'premium' | 'enterprise',
    module: string,
    action: string,
    tokens_used: number = 0,
    metadata: Record<string, any> = {}
  ): Promise<void> {
    // 1. Insert into usage_logs
    await db.query(
      `INSERT INTO usage_logs (user_id, module, action, tokens_used, metadata) VALUES ($1, $2, $3, $4, $5)`,
      [userId, module, action, tokens_used, JSON.stringify(metadata)]
    );

    // 2. Increment cache counter (if cached)
    const planConfig = QUOTA_CONFIG[userPlan] ?? QUOTA_CONFIG['free']!;
    const moduleConfig = planConfig[module];
    if (!moduleConfig) return;

    const { resetType } = moduleConfig;
    const cacheKey = `quota:${userId}:${module}:${resetType === 'daily' ? QuotaService.getDayStart().toISOString().slice(0, 10) : QuotaService.getMonthStart().toISOString().slice(0, 7)}`;

    const cached = await cache.get<number>(cacheKey);
    if (cached !== null) {
      const resetAt = resetType === 'daily' ? QuotaService.getNextDayStart() : QuotaService.getNextMonthStart();
      const ttlSeconds = Math.max(1, Math.floor((resetAt.getTime() - Date.now()) / 1000));
      await cache.set(cacheKey, cached + 1, ttlSeconds);
    }

    // 3. Award XP and update Streak
    await GamificationService.recordActivity(userId, 10);
  }

  /**
   * Get quota status for ALL modules (for GET /quota endpoint)
   */
  static async getAllQuotas(
    userId: string,
    userPlan: 'free' | 'premium' | 'enterprise'
  ): Promise<Record<string, Omit<QuotaCheckResult, 'allowed'>>> {
    const modules = ['solver', 'flashcard', 'note', 'quiz', 'exam', 'microlearn'];
    const result: Record<string, Omit<QuotaCheckResult, 'allowed'>> = {};

    await Promise.all(
      modules.map(async (module) => {
        const quota = await QuotaService.checkQuota(userId, userPlan, module);
        const { allowed: _allowed, ...rest } = quota;
        result[module] = rest;
      })
    );

    return result;
  }
}
