import { Router } from 'express';
import { SocialController } from '../controllers/social.controller.js';
import { authGuard } from '../middlewares/auth.middleware.js';
import { mediaUpload } from '../utils/multer.js';

const router = Router();

router.use(authGuard);

// Friendships
router.get('/friends', SocialController.listFriends);
router.get('/friends/requests', SocialController.listPendingRequests);
router.post('/friends/request/:userId', SocialController.sendFriendRequest);
router.post('/friends/accept/:requestId', SocialController.acceptFriendRequest);

// Messaging
router.get('/messages/unread-count', SocialController.getUnreadMessageCount);
router.get('/messages/partner/:partnerId', SocialController.getPartnerInfo);
router.get('/messages/conversations', SocialController.getConversations);
router.get('/messages/:friendId', SocialController.getConversation);
router.post('/messages/upload', mediaUpload.single('file'), SocialController.uploadMedia);
router.post('/messages/:recipientId', SocialController.sendMessage);

// Search
router.get('/search', SocialController.searchUsers);

export default router;
