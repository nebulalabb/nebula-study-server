import { Router } from 'express';
import { NoteController } from '../controllers/note.controller.js';
import { authGuard } from '../middlewares/auth.middleware.js';
import { quotaGuard } from '../middlewares/quota.middleware.js';
import { documentUpload } from '../utils/multer.js';

const router = Router();

// All note routes require authentication
router.use(authGuard);

// ── 5.1.4 GET /note
router.get('/', NoteController.listNotes);

// ── 5.1.9 GET /note/search
router.get('/search', NoteController.searchNotes);

// ── 5.1.8 POST /note (Final Save)
router.post('/', NoteController.saveNote);

// ── 5.1.2 POST /note/summarize
router.post('/summarize', quotaGuard('note'), NoteController.summarizeText);

// ── 5.1.3 POST /note/summarize/file
router.post('/summarize/file', quotaGuard('note'), documentUpload.single('file'), NoteController.summarizeFile);

// ── 5.1.5 GET /note/:note_id
router.get('/:note_id', NoteController.getNote);

// ── 5.1.6 PATCH /note/:note_id
router.patch('/:note_id', NoteController.updateNote);

// ── 5.1.7 DELETE /note/:note_id
router.delete('/:note_id', NoteController.deleteNote);

export default router;
