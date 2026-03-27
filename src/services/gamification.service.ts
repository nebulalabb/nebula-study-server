import { db } from '../db/index.js';
import { UserService, User } from './user.service.js';

export class GamificationService {
  /**
   * Records user activity and updates streak/XP
   * Should be called whenever a user performs a meaningful action (usage_log)
   */
  static async recordActivity(userId: string, xpGain: number = 10): Promise<User> {
    const user = await UserService.findById(userId);
    if (!user) throw new Error('User not found');

    const now = new Date();
    const lastActive = user.last_active_at ? new Date(user.last_active_at) : null;
    
    let newStreak = user.streak || 0;
    let newXp = (user.xp || 0) + xpGain;
    
    // 1. Calculate Streak
    if (!lastActive) {
      newStreak = 1;
    } else {
      const diffDays = this.getDiffDays(lastActive, now);
      
      if (diffDays === 1) {
        // Active yesterday, increment streak
        newStreak += 1;
      } else if (diffDays > 1) {
        // Missed a day, reset streak
        newStreak = 1;
      }
      // If diffDays === 0, it's the same day, streak stays the same
    }

    // 2. Calculate Level (Simple: every 1000 XP)
    const newLevel = Math.floor(newXp / 1000) + 1;

    // 3. Update Profile
    return await UserService.updateProfile(userId, {
      xp: newXp,
      streak: newStreak,
      level: newLevel,
      last_active_at: now
    });
  }

  /**
   * Gets the global ranking of a user based on XP
   */
  static async getGlobalRanking(userId: string): Promise<number> {
    const user = await UserService.findById(userId);
    if (!user) return 0;

    const result = await db.queryOne<{ count: string }>(
      'SELECT COUNT(*) as count FROM users WHERE xp > $1 AND deleted_at IS NULL',
      [user.xp]
    );
    
    // Ranking = (number of users with MORE xp) + 1
    return parseInt(result?.count ?? '0', 10) + 1;
  }

  /**
   * Helper to get difference in full days between two dates
   */
  private static getDiffDays(d1: Date, d2: Date): number {
    const date1 = new Date(d1.getFullYear(), d1.getMonth(), d1.getDate());
    const date2 = new Date(d2.getFullYear(), d2.getMonth(), d2.getDate());
    const diffTime = Math.abs(date2.getTime() - date1.getTime());
    return Math.floor(diffTime / (1000 * 60 * 60 * 24));
  }
}
