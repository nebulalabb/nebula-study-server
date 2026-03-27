import { db } from '../db/index.js';
import { QueryResultRow } from 'pg';
import { AppError, ERROR_CODES } from '../utils/AppError.js';

export interface User extends QueryResultRow {
  id: string;
  email: string;
  password_hash: string | null;
  full_name: string;
  avatar_url: string | null;
  role: 'student' | 'tutor' | 'admin';
  plan: 'free' | 'premium' | 'enterprise';
  plan_expires_at: Date | null;
  email_verified: boolean;
  locale: string;
  timezone: string;
  metadata: Record<string, any>;
  xp: number;
  level: number;
  streak: number;
  last_active_at: Date | null;
  deleted_at: Date | null;
  created_at: Date;
  updated_at: Date;
}

export class UserService {
  /**
   * Find a user by email
   */
  static async findByEmail(email: string): Promise<User | null> {
    return db.queryOne<User>('SELECT * FROM users WHERE email = $1 AND deleted_at IS NULL', [email]);
  }

  /**
   * Find a user by ID
   */
  static async findById(id: string): Promise<User | null> {
    return db.queryOne<User>('SELECT * FROM users WHERE id = $1 AND deleted_at IS NULL', [id]);
  }

  /**
   * Create a new user
   */
  static async createUser(data: {
    email: string;
    passwordHash: string;
    fullName: string;
  }): Promise<User> {
    const query = `
      INSERT INTO users (email, password_hash, full_name, role, plan)
      VALUES ($1, $2, $3, 'student', 'free')
      RETURNING *
    `;
    const res = await db.query<User>(query, [data.email, data.passwordHash, data.fullName]);
    if (res.rows.length === 0) {
      throw new AppError('Failed to create user', 500, ERROR_CODES.INTERNAL_SERVER_ERROR);
    }
    return res.rows[0]!;
  }

  /**
   * Mark email as verified
   */
  static async verifyEmail(userId: string): Promise<void> {
    await db.query('UPDATE users SET email_verified = true WHERE id = $1', [userId]);
  }

  /**
   * Update user profile fields (full_name, locale, timezone, metadata)
   */
  static async updateProfile(
    userId: string,
    data: { 
      full_name?: string; 
      locale?: string; 
      timezone?: string; 
      metadata?: Record<string, any>;
      xp?: number;
      level?: number;
      streak?: number;
      last_active_at?: Date | null;
    }
  ): Promise<User> {
    const setClauses: string[] = [];
    const values: any[] = [];
    let idx = 1;

    if (data.full_name !== undefined) { setClauses.push(`full_name = $${idx++}`); values.push(data.full_name); }
    if (data.locale !== undefined)    { setClauses.push(`locale = $${idx++}`);    values.push(data.locale); }
    if (data.timezone !== undefined)  { setClauses.push(`timezone = $${idx++}`);  values.push(data.timezone); }
    if (data.metadata !== undefined)  { setClauses.push(`metadata = $${idx++}`);  values.push(JSON.stringify(data.metadata)); }
    if (data.xp !== undefined)        { setClauses.push(`xp = $${idx++}`);        values.push(data.xp); }
    if (data.level !== undefined)     { setClauses.push(`level = $${idx++}`);     values.push(data.level); }
    if (data.streak !== undefined)    { setClauses.push(`streak = $${idx++}`);    values.push(data.streak); }
    if (data.last_active_at !== undefined) { setClauses.push(`last_active_at = $${idx++}`); values.push(data.last_active_at); }

    if (setClauses.length === 0) {
      const user = await UserService.findById(userId);
      if (!user) throw new AppError('User not found', 404, ERROR_CODES.RESOURCE_NOT_FOUND);
      return user;
    }

    values.push(userId);
    const query = `UPDATE users SET ${setClauses.join(', ')}, updated_at = NOW() WHERE id = $${idx} RETURNING *`;
    const res = await db.query<User>(query, values);
    if (res.rows.length === 0) throw new AppError('User not found', 404, ERROR_CODES.RESOURCE_NOT_FOUND);
    return res.rows[0]!;
  }

  /**
   * Update avatar_url
   */
  static async updateAvatar(userId: string, avatarUrl: string): Promise<User> {
    const res = await db.query<User>(
      'UPDATE users SET avatar_url = $1, updated_at = NOW() WHERE id = $2 RETURNING *',
      [avatarUrl, userId]
    );
    if (res.rows.length === 0) throw new AppError('User not found', 404, ERROR_CODES.RESOURCE_NOT_FOUND);
    return res.rows[0]!;
  }

  /**
   * Update password hash
   */
  static async updatePassword(userId: string, passwordHash: string): Promise<void> {
    await db.query('UPDATE users SET password_hash = $1, updated_at = NOW() WHERE id = $2', [passwordHash, userId]);
  }

  /**
   * Revoke all sessions except the current one (used after password change)
   */
  static async revokeAllOtherSessions(userId: string, currentRefreshToken?: string): Promise<void> {
    if (currentRefreshToken) {
      await db.query(
        'UPDATE user_sessions SET revoked_at = NOW() WHERE user_id = $1 AND refresh_token != $2 AND revoked_at IS NULL',
        [userId, currentRefreshToken]
      );
    } else {
      await db.query(
        'UPDATE user_sessions SET revoked_at = NOW() WHERE user_id = $1 AND revoked_at IS NULL',
        [userId]
      );
    }
  }

  /**
   * Get top users by XP (Leaderboard)
   */
  static async getLeaderboard(limit = 100): Promise<User[]> {
    const query = `
      SELECT id, full_name, avatar_url, xp, level, streak, created_at
      FROM users
      WHERE deleted_at IS NULL
      ORDER BY xp DESC, created_at ASC
      LIMIT $1
    `;
    const res = await db.query<User>(query, [limit]);
    return res.rows;
  }
  /**
   * Get student statistics (questions solved, accuracy, achievements)
   */
  static async getStudentStats(userId: string) {
    // 1. Solve histories (AI Tool)
    const solveCountRes = await db.queryOne<{ count: string }>(
      'SELECT COUNT(*) as count FROM solve_histories WHERE user_id = $1 AND deleted_at IS NULL',
      [userId]
    );
    const solveCount = parseInt(solveCountRes?.count ?? '0', 10);

    // 2. Exam attempts
    const examStatsRes = await db.queryOne<{ count: string; avg_percentage: string }>(
      `SELECT 
        COUNT(*) as count, 
        AVG(percentage) as avg_percentage 
       FROM exam_attempts 
       WHERE user_id = $1 AND status IN ('submitted', 'timeout')`,
      [userId]
    );
    const examCount = parseInt(examStatsRes?.count ?? '0', 10);
    const avgAccuracy = Math.round(parseFloat(examStatsRes?.avg_percentage ?? '0'));

    // 3. Simple Achievements Logic
    const user = await this.findById(userId);
    const achievements = [];
    
    if (solveCount >= 10) achievements.push({ id: 'zap', label: 'Siêu tốc', description: 'Hoàn thành 10+ quiz/bài tập' });
    if ((user?.streak ?? 0) >= 7) achievements.push({ id: 'heart', label: 'Chăm chỉ', description: 'Học liên tục 7 ngày' });
    if (avgAccuracy >= 90 && examCount >= 5) achievements.push({ id: 'target', label: 'Chính xác', description: 'Đạt 90%+ trong 5 đề' });
    if ((user?.xp ?? 0) >= 5000) achievements.push({ id: 'crown', label: 'Tinh Anh', description: 'Đạt mốc 5000 XP' });

    return {
      total_solved: solveCount + examCount,
      accuracy: examCount > 0 ? avgAccuracy : 0,
      achievements
    };
  }
}
