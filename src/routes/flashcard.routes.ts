import { Router } from 'express';
import { FlashcardController } from '../controllers/flashcard.controller.js';
import { authGuard } from '../middlewares/auth.middleware.js';
import { quotaGuard } from '../middlewares/quota.middleware.js';
import { documentUpload, imageUpload } from '../utils/multer.js';

const router = Router();

// ── 4.1.12 GET /flashcard/public/:token (Public)
router.get('/public/:token', FlashcardController.getPublicSet);

// All other flashcard routes require auth
router.use(authGuard);

// ── 4.1.4 GET /flashcard/sets
router.get('/sets', FlashcardController.listSets);

// ── 4.1.9 GET /flashcard/stats
router.get('/stats', FlashcardController.getStats);

// ── 4.1.6 POST /flashcard/sets (manual)
router.post('/sets', FlashcardController.createSet);

// ── 4.1.2 POST /flashcard/sets/generate/text
router.post('/sets/generate/text', quotaGuard('flashcard'), FlashcardController.generateFromText);

// ── 4.1.3 POST /flashcard/sets/generate/pdf
router.post('/sets/generate/pdf', quotaGuard('flashcard'), documentUpload.single('file'), FlashcardController.generateFromPdf);

// ── 4.1.3.1 AI Generation Preview (New)
router.post('/sets/preview/text', FlashcardController.previewGenerateText);
router.post('/sets/preview/pdf', documentUpload.single('file'), FlashcardController.previewGeneratePdf);

// ── 4.1.5 GET /flashcard/sets/:set_id
router.get('/sets/:set_id', FlashcardController.getSet);

// ── 4.1.7 POST /flashcard/sets/:set_id/cards
router.post('/sets/:set_id/cards', FlashcardController.addCards);

// ── 4.1.14 POST /flashcard/cards/:card_id/image
router.post('/cards/:card_id/image', imageUpload.single('file'), FlashcardController.uploadCardImage);

// ── 4.1.8 PATCH + DELETE /flashcard/sets/:set_id
router.patch('/sets/:set_id', FlashcardController.updateSet);
router.delete('/sets/:set_id', FlashcardController.deleteSet);

// ── 4.1.11 GET /flashcard/review/due
router.get('/review/due', FlashcardController.getDueCards);

// ── 4.1.10 POST /flashcard/review/submit
router.post('/review/submit', FlashcardController.submitReview);

// ── 4.1.13 POST /flashcard/sets/:set_id/clone
router.post('/sets/:set_id/clone', FlashcardController.cloneSet);

export default router;
