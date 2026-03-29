import { Request, Response, NextFunction } from 'express';
import { db } from '../db/index.js';
import { sendSuccess } from '../utils/response.js';
import { AppError, ERROR_CODES } from '../utils/AppError.js';
import { NotificationService } from '../services/notification.service.js';

export class CommunityController {

  // ── FORUM ──────────────────────────────────────────────────────────────────

  static async getCategories(req: Request, res: Response, next: NextFunction) {
    try {
      const { rows } = await db.query('SELECT * FROM forum_categories ORDER BY created_at ASC');
      return sendSuccess(res, { items: rows });
    } catch (err) { next(err); }
  }

  static async getTopics(req: Request, res: Response, next: NextFunction) {
    try {
      const { categoryId } = req.query;
      const { limit = 20, offset = 0 } = req.query;

      let query = `
        SELECT t.*, u.full_name as author_name, u.avatar_url as author_avatar,
               (SELECT COUNT(*) FROM forum_posts WHERE topic_id = t.id) as reply_count,
               (SELECT COALESCE(SUM(vote_type), 0) FROM forum_votes WHERE topic_id = t.id) as vote_score,
               t.tags
        FROM forum_topics t
        JOIN users u ON t.author_id = u.id
      `;
      const params: any[] = [];

      if (categoryId) {
        query += ' WHERE t.category_id = $1';
        params.push(categoryId);
      }

      query += ` ORDER BY t.is_pinned DESC, t.created_at DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`;
      params.push(Number(limit), Number(offset));

      const { rows } = await db.query(query, params);
      return sendSuccess(res, { items: rows });
    } catch (err) { next(err); }
  }

  static async createTopic(req: Request, res: Response, next: NextFunction) {
    try {
      const { category_id, title, content, tags = [] } = req.body;
      const authorId = req.user!.id;

      if (!category_id || !title || !content) {
        throw new AppError('Thiếu thông tin bắt buộc', 400, ERROR_CODES.VALIDATION_FAILED);
      }

      const slug = title.toLowerCase().trim()
        .replace(/[^\w\s-]/g, '')
        .replace(/[\s_-]+/g, '-')
        .replace(/^-+|-+$/g, '') + '-' + Date.now();

      const { rows } = await db.query(
        'INSERT INTO forum_topics (category_id, author_id, title, slug, content, tags) VALUES ($1, $2, $3, $4, $5, $6) RETURNING *',
        [category_id, authorId, title, slug, content, tags]
      );

      return sendSuccess(res, { topic: rows[0] }, 201);
    } catch (err) { next(err); }
  }

  static async getTopic(req: Request, res: Response, next: NextFunction) {
    try {
      const { slug } = req.params;
      const userId = req.user?.id;

      const topic = await db.queryOne(`
        SELECT t.*, u.full_name as author_name, u.avatar_url as author_avatar,
               c.name as category_name,
               (SELECT COALESCE(SUM(vote_type), 0) FROM forum_votes WHERE topic_id = t.id) as vote_score,
               (SELECT vote_type FROM forum_votes WHERE topic_id = t.id AND user_id = $1) as user_vote,
               t.tags
        FROM forum_topics t
        JOIN users u ON t.author_id = u.id
        JOIN forum_categories c ON t.category_id = c.id
        WHERE t.slug = $2
      `, [userId, slug]);

      if (!topic) {
        throw new AppError('Không tìm thấy chủ đề', 404, ERROR_CODES.RESOURCE_NOT_FOUND);
      }

      // Increment views
      await db.query('UPDATE forum_topics SET views = views + 1 WHERE id = $1', [topic.id]);

      const { rows: posts } = await db.query(`
        SELECT p.*, u.full_name as author_name, u.avatar_url as author_avatar,
               (SELECT COALESCE(SUM(vote_type), 0) FROM forum_votes WHERE post_id = p.id) as vote_score,
               (SELECT vote_type FROM forum_votes WHERE post_id = p.id AND user_id = $1) as user_vote
        FROM forum_posts p
        JOIN users u ON p.author_id = u.id
        WHERE p.topic_id = $2
        ORDER BY p.created_at ASC
      `, [userId, topic.id]);

      return sendSuccess(res, { topic, posts });
    } catch (err) { next(err); }
  }

  static async createPost(req: Request, res: Response, next: NextFunction) {
    try {
      const { topic_id, content, parent_id } = req.body;
      const authorId = req.user!.id;

      if (!topic_id || !content) {
        throw new AppError('Thiếu thông tin bắt buộc', 400, ERROR_CODES.VALIDATION_FAILED);
      }

      const { rows } = await db.query(
        'INSERT INTO forum_posts (topic_id, author_id, parent_id, content) VALUES ($1, $2, $3, $4) RETURNING *',
        [topic_id, authorId, parent_id || null, content]
      );

      // Notify topic author
      const topic = await db.queryOne('SELECT author_id, title FROM forum_topics WHERE id = $1', [topic_id]);
      if (topic && topic.author_id !== authorId) {
        await NotificationService.createNotification(
          topic.author_id,
          'forum_reply',
          'Phản hồi mới trong diễn đàn',
          `${req.user!.full_name} đã phản hồi bài viết "${topic.title}" của bạn.`,
          { topic_id: topic_id, slug: (await db.queryOne('SELECT slug FROM forum_topics WHERE id = $1', [topic_id])).slug }
        );
      }

      return sendSuccess(res, { post: rows[0] }, 201);
    } catch (err) { next(err); }
  }

  static async vote(req: Request, res: Response, next: NextFunction) {
    try {
      const { topic_id, post_id, vote_type } = req.body; // vote_type: 1 or -1, 0 to remove
      const userId = req.user!.id;

      if (!topic_id && !post_id) {
        throw new AppError('Cần cung cấp topic_id hoặc post_id', 400, ERROR_CODES.VALIDATION_FAILED);
      }

      if (vote_type === 0) {
        await db.query(
          'DELETE FROM forum_votes WHERE user_id = $1 AND (topic_id = $2 OR post_id = $3)',
          [userId, topic_id || null, post_id || null]
        );
      } else {
        await db.query(`
          INSERT INTO forum_votes (user_id, topic_id, post_id, vote_type)
          VALUES ($1, $2, $3, $4)
          ON CONFLICT (user_id, topic_id) DO UPDATE SET vote_type = $4
          ON CONFLICT (user_id, post_id) DO UPDATE SET vote_type = $4
        `, [userId, topic_id || null, post_id || null, vote_type]);
      }

      return sendSuccess(res, { message: 'Đã cập nhật bình chọn' });
    } catch (err) { next(err); }
  }

  // ── FEED ───────────────────────────────────────────────────────────────────

  static async getFeed(req: Request, res: Response, next: NextFunction) {
    try {
      const userId = req.user!.id;
      const { limit = 20, offset = 0 } = req.query;

      const { rows } = await db.query(`
        SELECT p.*, u.full_name as author_name, u.avatar_url as author_avatar,
               (SELECT COUNT(*) FROM feed_likes WHERE post_id = p.id) as like_count,
               (SELECT COUNT(*) FROM feed_comments WHERE post_id = p.id) as comment_count,
               EXISTS(SELECT 1 FROM feed_likes WHERE post_id = p.id AND user_id = $1) as is_liked
        FROM feed_posts p
        JOIN users u ON p.author_id = u.id
        WHERE p.privacy = 'public' 
           OR (p.privacy = 'friends' AND (p.author_id = $1 OR EXISTS(
                 SELECT 1 FROM friendships 
                 WHERE status = 'accepted' 
                   AND ((requester_id = $1 AND addressee_id = p.author_id) OR (requester_id = p.author_id AND addressee_id = $1))
               )))
           OR (p.privacy = 'private' AND p.author_id = $1)
        ORDER BY p.created_at DESC
        LIMIT $2 OFFSET $3
      `, [userId, Number(limit), Number(offset)]);

      return sendSuccess(res, { items: rows });
    } catch (err) { next(err); }
  }

  static async createFeedPost(req: Request, res: Response, next: NextFunction) {
    try {
      const { content, media_urls = [], privacy = 'public', feeling = null } = req.body;
      const authorId = req.user!.id;

      const { rows } = await db.query(
        'INSERT INTO feed_posts (author_id, content, media_urls, privacy, feeling) VALUES ($1, $2, $3, $4, $5) RETURNING *',
        [authorId, content, JSON.stringify(media_urls), privacy, feeling ? JSON.stringify(feeling) : null]
      );

      return sendSuccess(res, { post: rows[0] }, 201);
    } catch (err) { next(err); }
  }

  static async toggleLike(req: Request, res: Response, next: NextFunction) {
    try {
      const { postId } = req.params;
      const userId = req.user!.id;

      const existing = await db.queryOne(
        'SELECT id FROM feed_likes WHERE user_id = $1 AND post_id = $2',
        [userId, postId]
      );

      if (existing) {
        await db.query('DELETE FROM feed_likes WHERE id = $1', [existing.id]);
        return sendSuccess(res, { liked: false });
      } else {
        await db.query('INSERT INTO feed_likes (user_id, post_id) VALUES ($1, $2)', [userId, postId]);
        
        // Notify post author
        const post = await db.queryOne('SELECT author_id FROM feed_posts WHERE id = $1', [postId]);
        if (post && post.author_id !== userId) {
          await NotificationService.createNotification(
            post.author_id,
            'feed_like',
            'Lượt thích mới',
            `${req.user!.full_name} đã thích bài viết của bạn.`,
            { post_id: postId }
          );
        }
        
        return sendSuccess(res, { liked: true });
      }
    } catch (err) { next(err); }
  }

  static async addComment(req: Request, res: Response, next: NextFunction) {
    try {
      const { postId } = req.params;
      const { content } = req.body;
      const authorId = req.user!.id;

      if (!content) {
        throw new AppError('Bình luận không được để trống', 400, ERROR_CODES.VALIDATION_FAILED);
      }

      const { rows } = await db.query(
        'INSERT INTO feed_comments (post_id, author_id, content) VALUES ($1, $2, $3) RETURNING *',
        [postId, authorId, content]
      );

      // Notify post author
      const post = await db.queryOne('SELECT author_id FROM feed_posts WHERE id = $1', [postId]);
      if (post && post.author_id !== authorId) {
        await NotificationService.createNotification(
          post.author_id,
          'feed_comment',
          'Bình luận mới',
          `${req.user!.full_name} đã bình luận về bài viết của bạn.`,
          { post_id: postId }
        );
      }

      return sendSuccess(res, { comment: rows[0] }, 201);
    } catch (err) { next(err); }
  }

  static async getComments(req: Request, res: Response, next: NextFunction) {
    try {
      const { postId } = req.params;
      const { rows } = await db.query(`
        SELECT c.*, u.full_name as author_name, u.avatar_url as author_avatar
        FROM feed_comments c
        JOIN users u ON c.author_id = u.id
        WHERE c.post_id = $1
        ORDER BY c.created_at ASC
      `, [postId]);

      return sendSuccess(res, { items: rows });
    } catch (err) { next(err); }
  }

  static async deleteFeedPost(req: Request, res: Response, next: NextFunction) {
    try {
      const { postId } = req.params;
      const userId = req.user!.id;

      const post = await db.queryOne('SELECT author_id FROM feed_posts WHERE id = $1', [postId]);
      if (!post) {
        throw new AppError('Không tìm thấy bài viết', 404, ERROR_CODES.RESOURCE_NOT_FOUND);
      }

      if (post.author_id !== userId) {
        throw new AppError('Bạn không có quyền xóa bài viết này', 403, ERROR_CODES.FORBIDDEN);
      }

      await db.query('DELETE FROM feed_posts WHERE id = $1', [postId]);
      return sendSuccess(res, { message: 'Đã xóa bài viết' });
    } catch (err) { next(err); }
  }
}
