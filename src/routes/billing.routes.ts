import { Router } from 'express';
import { BillingController } from '../controllers/billing.controller.js';
import { authGuard } from '../middlewares/auth.middleware.js';

const router = Router();

// ── Public Routes (Webhooks & Plan List)
router.get('/plans', BillingController.listPlans);
router.post('/webhook/vnpay', BillingController.vnPayWebhook);
router.post('/webhook/momo', BillingController.momoWebhook);

// ── Protected Routes
router.use(authGuard);

router.post('/subscribe', BillingController.createSubscriptionFlow);
router.get('/pending', BillingController.getPending);
router.get('/history', BillingController.getHistory);
router.get('/admin/payments', BillingController.getAllPayments);
router.post('/approve', BillingController.approvePayment);
router.post('/subscription/cancel', BillingController.cancelSubscription);

export default router;
