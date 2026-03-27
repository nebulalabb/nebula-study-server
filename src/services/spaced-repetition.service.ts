/**
 * 4.1.9 — SpacedRepetitionService
 * Triển khai đầy đủ thuật toán SM-2
 * Theo Database.md mục 4.3 + BeNho.txt Module 1
 *
 * SM-2 Algorithm:
 *   quality 0-5 (mapped from UI difficulty)
 *   If quality >= 3 (remembered):
 *     repetition(1) = 1 day, repetition(2) = 6 days
 *     interval(n) = interval(n-1) * easiness_factor
 *     easiness_factor = max(1.3, ef + 0.1 - (5 - quality) * 0.08)
 *   If quality < 3 (forgot):
 *     repetition = 0, interval = 1 day
 */

export type ReviewRating = 'easy' | 'medium' | 'hard' | 'again';

export interface ReviewScheduleInput {
  repetition: number;
  easiness_factor: number;
  interval_days: number;
}

export interface ReviewScheduleOutput {
  repetition: number;
  easiness_factor: number;
  interval_days: number;
  next_review_at: Date;
  quality: number; // 0-5
}

/**
 * Map UI difficulty to SM-2 quality score (0–5)
 * easy   → 5 (perfect recall)
 * medium → 3 (correct with hesitation)
 * hard   → 1 (incorrect; correct when shown the answer)
 * again  → 0 (complete blackout)
 */
export function ratingToQuality(rating: ReviewRating): number {
  switch (rating) {
    case 'easy':   return 5;
    case 'medium': return 3;
    case 'hard':   return 1;
    case 'again':  return 0;
  }
}

export class SpacedRepetitionService {
  private static readonly MIN_EF = 1.3;
  private static readonly MAX_EF = 2.5;

  /**
   * Calculate next review schedule from current state + quality score.
   * Returns updated SM-2 fields and the next review timestamp.
   */
  static calculate(current: ReviewScheduleInput, quality: number): ReviewScheduleOutput {
    let { repetition, easiness_factor, interval_days } = current;

    if (quality >= 3) {
      // Remembered — advance the schedule
      if (repetition === 0) {
        interval_days = 1;
      } else if (repetition === 1) {
        interval_days = 6;
      } else {
        interval_days = Math.round(interval_days * easiness_factor);
      }
      repetition += 1;

      // Update easiness factor
      easiness_factor = easiness_factor + 0.1 - (5 - quality) * 0.08;
      easiness_factor = Math.max(SpacedRepetitionService.MIN_EF, Math.min(SpacedRepetitionService.MAX_EF, easiness_factor));
    } else {
      // Forgot — reset
      repetition = 0;
      interval_days = 1;
      // easiness_factor stays, but floor at 1.3
      easiness_factor = Math.max(SpacedRepetitionService.MIN_EF, easiness_factor);
    }

    const next_review_at = new Date();
    next_review_at.setDate(next_review_at.getDate() + interval_days);
    // Set to start of the day for cleaner scheduling
    next_review_at.setHours(0, 0, 0, 0);

    return {
      repetition,
      easiness_factor: parseFloat(easiness_factor.toFixed(2)),
      interval_days,
      next_review_at,
      quality,
    };
  }

  /**
   * Simple shorthand used by 4.1.10 endpoint:
   * Convert a UI rating ('easy'|'medium'|'hard'|'again') → quality → schedule
   */
  static fromRating(current: ReviewScheduleInput, rating: ReviewRating): ReviewScheduleOutput {
    const quality = ratingToQuality(rating);
    return SpacedRepetitionService.calculate(current, quality);
  }
}
