import express, { Express, Request, Response } from 'express';
import { createServer } from 'http';
import { initSocket } from './socket.js';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import * as dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

import { globalLimiter } from './middlewares/rateLimiter';
import { errorHandler } from './middlewares/error.handler';
import { sendSuccess } from './utils/response';
import logger from './utils/logger';
// import { initEmailWorker } from './workers/email.worker.js'; // Removed: No longer using Bull/Redis
import authRoutes from './routes/auth.routes.js';
import userRoutes from './routes/user.routes.js';
import quotaRoutes from './routes/quota.routes.js';
import solverRoutes from './routes/solver.routes.js';
import flashcardRoutes from './routes/flashcard.routes.js';
import noteRoutes from './routes/note.routes.js';
import quizRoutes from './routes/quiz.routes.js';
import examRoutes from './routes/exam.routes.js';
import billingRoutes from './routes/billing.routes.js';
import microlearnRoutes from './routes/microlearn.routes.js';
import tutorRoutes from './routes/tutor.routes.js';
import notificationRoutes from './routes/notification.routes.js';
import adminRoutes from './routes/admin.routes.js';
import socialRoutes from './routes/social.routes.js';
import supportRoutes from './routes/support.routes.js';

import { initBillingWorker } from './workers/billing.worker.js';
import { initStreakWorker } from './workers/streak.worker.js';
import { initFlashcardWorker } from './workers/flashcard.worker.js';

// Load environment variables
dotenv.config();

// Initialize Workers
// initEmailWorker(); // Disabled: Email processing is now handled asynchronously in email.queue.ts without Bull/Redis
initBillingWorker();
initStreakWorker();
initFlashcardWorker();

const app: Express = express();
const port = process.env.PORT || 3001;

// 1. Security & Logging Middleware
app.use(helmet());
app.use(cors({
  origin: process.env.FRONTEND_URL || 'http://localhost:3000',
  credentials: true,
}));
app.use(morgan('dev'));
app.use(globalLimiter);

// 2. Parsing Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// 3. Routes
app.get('/health', (req: Request, res: Response) => {
  return sendSuccess(res, { status: 'OK', uptime: process.uptime() });
});

app.get('/', (req: Request, res: Response) => {
  return sendSuccess(res, { message: 'Welcome to NebulaLab.vn API' });
});

// Auth Routes
app.use('/v1/auth', authRoutes);

// User Profile Routes
app.use('/v1/user', userRoutes);

// Quota Routes
app.use('/v1/quota', quotaRoutes);

// Solver Routes
app.use('/v1/solver', solverRoutes);

// Flashcard Routes
app.use('/v1/flashcard', flashcardRoutes);

// Note & Summary Routes
app.use('/v1/note', noteRoutes);

// Quiz Generator Routes
app.use('/v1/quiz', quizRoutes);

// Exam / Luyện đề 4.0 Routes
app.use('/v1/exam', examRoutes);

// Micro-Learning Routes
app.use('/v1/microlearn', microlearnRoutes);

// Tutor Marketplace Routes
app.use('/v1/tutor', tutorRoutes);

// Billing & Subscription Routes
app.use('/v1/billing', billingRoutes);

// Notification Routes
app.use('/v1/notification', notificationRoutes);

// Admin Routes
app.use('/v1/admin', adminRoutes);

// Social Routes
app.use('/v1/social', socialRoutes);

// Support Routes
app.use('/v1/support', supportRoutes);

// 4. Global Error Handler (Must be last)
app.use(errorHandler);

const httpServer = createServer(app);
initSocket(httpServer);

httpServer.listen(port, () => {
  logger.info(`Server is running at http://localhost:${port}`);
});

export default app;
