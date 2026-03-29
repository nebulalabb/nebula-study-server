import { Router } from 'express';
import { CommunityController } from '../controllers/community.controller.js';
import { authGuard } from '../middlewares/auth.middleware.js';

const router = Router();

// ── FORUM ──
router.get('/forum/categories', CommunityController.getCategories);
router.get('/forum/topics', CommunityController.getTopics);
router.get('/forum/topic/:slug', CommunityController.getTopic);
router.post('/forum/topic', authGuard, CommunityController.createTopic);
router.post('/forum/post', authGuard, CommunityController.createPost);
router.post('/forum/vote', authGuard, CommunityController.vote);

// ── FEED ──
router.get('/feed', authGuard, CommunityController.getFeed);
router.post('/feed', authGuard, CommunityController.createFeedPost);
router.post('/feed/:postId/like', authGuard, CommunityController.toggleLike);
router.get('/feed/:postId/comments', authGuard, CommunityController.getComments);
router.delete('/feed/:postId', authGuard, CommunityController.deleteFeedPost);

export default router;
