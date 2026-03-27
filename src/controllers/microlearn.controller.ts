import { Request, Response, NextFunction } from 'express';
import { db } from '../db/index.js';
import { sendSuccess } from '../utils/response.js';
import { AppError, ERROR_CODES } from '../utils/AppError.js';

export class MicrolearnController {

  // ── 9.1.3 GET /microlearn/topics ──────────────────────────────────────────
  static async listTopics(req: Request, res: Response, next: NextFunction) {
    try {
      const user = req.user!;
      const { rows } = await db.query(`
        SELECT t.*, 
          EXISTS(SELECT 1 FROM user_topic_subscriptions s WHERE s.topic_id = t.id AND s.user_id = $1) as is_subscribed
        FROM learning_topics t
        WHERE t.is_active = TRUE
        ORDER BY t.sort_order ASC
      `, [user?.id]);
      return sendSuccess(res, { items: rows });
    } catch (err) { next(err); }
  }

  // ── 9.1.4 POST /microlearn/topics/:topic_id/subscribe ────────────────────
  static async subscribeTopic(req: Request, res: Response, next: NextFunction) {
    try {
      const user = req.user!;
      const { topic_id } = req.params;
      const { notification_time } = req.body; // e.g., "08:00"

      const topic = await db.queryOne('SELECT id FROM learning_topics WHERE id = $1', [topic_id]);
      if (!topic) throw new AppError('Chủ đề không tồn tại', 404, ERROR_CODES.RESOURCE_NOT_FOUND);

      const client = await db.getClient();
      try {
        await client.query('BEGIN');

        await client.query(
          `INSERT INTO user_topic_subscriptions (user_id, topic_id, subscribed_at, current_day)
           VALUES ($1, $2, NOW(), 1)
           ON CONFLICT (user_id, topic_id) DO NOTHING`,
          [user.id, topic.id]
        );

        // Update or Insert notification time in user_streaks
        await client.query(`
          INSERT INTO user_streaks (user_id, notification_time)
          VALUES ($1, $2)
          ON CONFLICT (user_id) DO UPDATE SET notification_time = $2
        `, [user.id, notification_time || '08:00:00']);

        await client.query('COMMIT');
        return sendSuccess(res, { message: 'Đăng ký thành công' });
      } catch (err) {
        await client.query('ROLLBACK');
        throw err;
      } finally {
        client.release();
      }
    } catch (err) { next(err); }
  }

  // ── 9.1.5 GET /microlearn/today ──────────────────────────────────────────
  static async getTodayLessons(req: Request, res: Response, next: NextFunction) {
    try {
      const user = req.user!;
      const isPremium = user.plan === 'premium';
      
      // Get all active subscriptions for user
      const { rows: subs } = await db.query(`
        SELECT s.topic_id, t.name as topic_name, t.icon_url
        FROM user_topic_subscriptions s
        JOIN learning_topics t ON s.topic_id = t.id
        WHERE s.user_id = $1 AND t.is_active = TRUE
      `, [user.id]);

      if (subs.length === 0) {
        return sendSuccess(res, { items: [], message: 'Bạn chưa đăng ký chủ đề nào' });
      }

      const todayLessons: any[] = [];

      for (const sub of subs) {
        // Find the first unread lesson for this topic
        // Logic: Prioritize unread, follow publish_date, respect premium status
        let query = `
          SELECT dl.* FROM daily_lessons dl
          LEFT JOIN user_lesson_progress ulp ON dl.id = ulp.lesson_id AND ulp.user_id = $1
          WHERE dl.topic_id = $2 AND (ulp.id IS NULL OR ulp.status != 'completed')
        `;
        const params: any[] = [user.id, sub.topic_id];

        if (!isPremium) {
          query += ` AND dl.is_free = TRUE`;
        }

        query += ` ORDER BY dl.publish_date ASC, dl.created_at ASC LIMIT 1`;

        let lesson = await db.queryOne(query, params);

        // Fallback: If no unread lessons, pick the most recently published one (even if read)
        if (!lesson) {
          let fallbackQuery = `SELECT * FROM daily_lessons WHERE topic_id = $1`;
          if (!isPremium) fallbackQuery += ` AND is_free = TRUE`;
          fallbackQuery += ` ORDER BY publish_date DESC, created_at DESC LIMIT 1`;
          lesson = await db.queryOne(fallbackQuery, [sub.topic_id]);
        }

        if (lesson) {
          // Check progress again for the lesson we found
          const progress = await db.queryOne(`
            SELECT status FROM user_lesson_progress 
            WHERE user_id = $1 AND lesson_id = $2
          `, [user.id, lesson.id]);

          lesson.topic_name = sub.topic_name;
          lesson.topic_icon_url = sub.icon_url;
          lesson.progress_status = progress?.status || 'not_started';
          todayLessons.push(lesson);
        }
      }

      return sendSuccess(res, { items: todayLessons });
    } catch (err) { next(err); }
  }

  // ── 9.1.6 POST /microlearn/lesson/:lesson_id/complete ────────────────────
  // Body: { answer_id: "A" }
  static async completeLesson(req: Request, res: Response, next: NextFunction) {
    try {
      const user = req.user!;
      const { lesson_id } = req.params;
      const { answer_id } = req.body;

      const lesson = await db.queryOne('SELECT * FROM daily_lessons WHERE id = $1', [lesson_id]);
      if (!lesson) throw new AppError('Bài học không tồn tại', 404, ERROR_CODES.RESOURCE_NOT_FOUND);

      // Check Quiz correctness
      let isCorrect = null;
      if (lesson.quiz_question && typeof lesson.quiz_question === 'object') {
        const correctAns = lesson.quiz_question.correct;
        if (answer_id) {
           isCorrect = (answer_id === correctAns);
        }
      }

      const client = await db.getClient();
      try {
        await client.query('BEGIN');

        // 1. Update Progress
        await client.query(`
          INSERT INTO user_lesson_progress (user_id, lesson_id, topic_id, status, quiz_answered, quiz_correct, completed_at)
          VALUES ($1, $2, $3, 'completed', $4, $5, NOW())
          ON CONFLICT (user_id, lesson_id) 
          DO UPDATE SET status = 'completed', quiz_answered = $4, quiz_correct = $5, completed_at = NOW()
        `, [user.id, lesson.id, lesson.topic_id, answer_id ? true : false, isCorrect]);

        // 2. Advance Subscription to next day
        await client.query(`
          UPDATE user_topic_subscriptions 
          SET current_day = current_day + 1 
          WHERE user_id = $1 AND topic_id = $2
        `, [user.id, lesson.topic_id]);

        // 3. Update Streak
        const streak = await client.query(`SELECT * FROM user_streaks WHERE user_id = $1`, [user.id]);
        const today = new Date().toISOString().split('T')[0];

        if (streak.rows.length === 0) {
          // first time
          await client.query(`
            INSERT INTO user_streaks (user_id, current_streak, longest_streak, last_activity_date, total_days_learned)
            VALUES ($1, 1, 1, $2, 1)
          `, [user.id, today]);
        } else {
          const s = streak.rows[0];
          const lastDate = s.last_activity_date ? new Date(s.last_activity_date).toISOString().split('T')[0] : null;
          
          if (lastDate !== today) {
            // Check if exactly yesterday
            const yesterdayObj = new Date();
            yesterdayObj.setDate(yesterdayObj.getDate() - 1);
            const yesterday = yesterdayObj.toISOString().split('T')[0];

            let newCurrent = lastDate === yesterday ? s.current_streak + 1 : 1;
            let newLongest = Math.max(s.longest_streak, newCurrent);

            await client.query(`
              UPDATE user_streaks 
              SET current_streak = $1, longest_streak = $2, last_activity_date = $3, total_days_learned = total_days_learned + 1, updated_at = NOW()
              WHERE user_id = $4
            `, [newCurrent, newLongest, today, user.id]);
          }
        }

        await client.query('COMMIT');
        
        return sendSuccess(res, { message: 'Hoàn thành bài học', is_correct: isCorrect });
      } catch (e) {
        await client.query('ROLLBACK');
        throw e;
      } finally {
        client.release();
      }
    } catch (err) { next(err); }
  }

  // ── 9.1.7 GET /microlearn/streak ──────────────────────────────────────────
  static async getStreak(req: Request, res: Response, next: NextFunction) {
    try {
      const user = req.user!;
      const streak = await db.queryOne('SELECT * FROM user_streaks WHERE user_id = $1', [user.id]);
      
      let currentStreak = 0;
      let longestStreak = 0;
      let totalDays = 0;
      let lastActivity = null;

      if (streak) {
        lastActivity = streak.last_activity_date ? new Date(streak.last_activity_date).toISOString().split('T')[0] : null;
        
        // If last activity is older than yesterday, current streak is visually 0 for today
        const todayObj = new Date();
        const yesterdayObj = new Date();
        yesterdayObj.setDate(todayObj.getDate() - 1);
        
        const todayStr = todayObj.toISOString().split('T')[0];
        const yesterdayStr = yesterdayObj.toISOString().split('T')[0];

        if (lastActivity === todayStr || lastActivity === yesterdayStr) {
           currentStreak = streak.current_streak;
        } else {
           currentStreak = 0;
        }

        longestStreak = streak.longest_streak;
        totalDays = streak.total_days_learned;
      }

      return sendSuccess(res, { 
        current_streak: currentStreak, 
        longest_streak: longestStreak, 
        total_days: totalDays,
        last_activity_date: lastActivity
      });
    } catch (err) { next(err); }
  }

  // ── 9.1.8 GET /microlearn/history ──────────────────────────────────────────
  static async listHistory(req: Request, res: Response, next: NextFunction) {
    try {
      const user = req.user!;
      const { rows } = await db.query(`
        SELECT completed_at::date as date, COUNT(*) as count
        FROM user_lesson_progress
        WHERE user_id = $1 AND status = 'completed' AND completed_at IS NOT NULL
        GROUP BY date
        ORDER BY date DESC
        LIMIT 365
      `, [user.id]);
      
      return sendSuccess(res, { items: rows });
    } catch (err) { next(err); }
  }
}
