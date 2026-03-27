import { Request, Response, NextFunction } from 'express';
import { db } from '../db/index.js';
import { sendSuccess } from '../utils/response.js';
import { AppError, ERROR_CODES } from '../utils/AppError.js';
import crypto from 'crypto';
import qs from 'qs';
import { addDays, addMonths, addYears } from 'date-fns';
import cache from '../utils/cache.js';
import { NotificationService } from '../services/notification.service.js';

/**
 * Helper: Tạo VNPay URL ký tự động
 */
function createVnPayUrl(ipAddr: string, orderId: string, amountVnd: number, returnUrl: string): string {
  const tmnCode = process.env.VNPAY_TMNCODE || 'VNPAY_DUMMY_TMN';
  const secretKey = process.env.VNPAY_HASHSECRET || 'VNPAY_DUMMY_SECRET';
  const vnpUrl = process.env.VNPAY_URL || 'https://sandbox.vnpayment.vn/paymentv2/vpcpay.html';
  
  const date = new Date();
  const createDate = date.toISOString().replace(/T|:|-|\..+/g, '').slice(0, 14); // YYYYMMDDHHmmss

  let vnp_Params: any = {};
  vnp_Params['vnp_Version'] = '2.1.0';
  vnp_Params['vnp_Command'] = 'pay';
  vnp_Params['vnp_TmnCode'] = tmnCode;
  vnp_Params['vnp_Locale'] = 'vn';
  vnp_Params['vnp_CurrCode'] = 'VND';
  vnp_Params['vnp_TxnRef'] = orderId;
  vnp_Params['vnp_OrderInfo'] = `Thanh toan don hang ${orderId}`;
  vnp_Params['vnp_OrderType'] = 'billpayment';
  vnp_Params['vnp_Amount'] = amountVnd * 100;
  vnp_Params['vnp_ReturnUrl'] = returnUrl;
  vnp_Params['vnp_IpAddr'] = ipAddr;
  vnp_Params['vnp_CreateDate'] = createDate;

  // Sắp xếp tham số theo alphabet
  vnp_Params = Object.keys(vnp_Params)
      .sort()
      .reduce((obj: any, key) => {
          obj[key] = vnp_Params[key];
          return obj;
      }, {});

  const signData = qs.stringify(vnp_Params, { encode: false });
  const hmac = crypto.createHmac('sha512', secretKey);
  const signed = hmac.update(Buffer.from(signData, 'utf-8')).digest('hex'); 
  vnp_Params['vnp_SecureHash'] = signed;
  
  return vnpUrl + '?' + qs.stringify(vnp_Params, { encode: false });
}

export class BillingController {

  // ── 7.1.3 GET /billing/plans ───────────────────────────────────────────────
  static async listPlans(req: Request, res: Response, next: NextFunction) {
    try {
      const { rows } = await db.query(
        'SELECT id, name, display_name, price_vnd, billing_cycle, features FROM subscription_plans WHERE is_active = TRUE ORDER BY sort_order ASC'
      );
      return sendSuccess(res, { plans: rows });
    } catch (err) { next(err); }
  }

  // ── 7.1.4 POST /billing/subscribe ──────────────────────────────────────────
  static async createSubscriptionFlow(req: Request, res: Response, next: NextFunction) {
    try {
      const user = req.user!;
      const { plan_id, gateway = 'vnpay', return_url } = req.body;

      if (!plan_id) throw new AppError('Missing plan_id', 400, ERROR_CODES.VALIDATION_FAILED);

      // Validate Plan
      const plan = await db.queryOne('SELECT id, price_vnd, name FROM subscription_plans WHERE id = $1 AND is_active = TRUE AND price_vnd > 0', [plan_id]);
      if (!plan) throw new AppError('Gói cước không hợp lệ hoặc không cần thanh toán', 400, ERROR_CODES.VALIDATION_FAILED);

      // Ensure user doesn't already have an active sub for this plan? Actually, let's keep it simple.
      // Generate unique order id for payment
      const orderId = `${user.id.slice(0,4)}_${Date.now()}`;

      // Insert Pending Payment pointing to raw Plan data for fulfillment later
      const client = await db.getClient();
      let paymentId: string;
      try {
        await client.query('BEGIN');
        const pRow = await client.query<{ id: string }>(
          `INSERT INTO payments (user_id, amount_vnd, gateway, gateway_txn_id, note)
           VALUES ($1, $2, $3, $4, $5) RETURNING id`,
          [user.id, plan.price_vnd, gateway, orderId, `plan_id:${plan.id}`]
        );
        paymentId = pRow.rows[0]!.id;
        await client.query('COMMIT');
      } catch (err) {
        await client.query('ROLLBACK');
        throw err;
      } finally {
        client.release();
      }

      // Generate Checkout URL
      let checkoutUrl = '';
      if (gateway === 'vnpay') {
        const ipAddr = req.headers['x-forwarded-for'] || req.socket.remoteAddress || '127.0.0.1';
        const defaultReturnUrl = `${process.env.APP_URL || 'http://localhost:3000'}/billing/vnpay_return`;
        checkoutUrl = createVnPayUrl(ipAddr as string, orderId, plan.price_vnd, return_url || defaultReturnUrl);
      } else if (gateway === 'manual') {
        // Manual bank transfer: no redirect needed. Payment stays 'pending' until admin confirms.
        checkoutUrl = '';
      } else {
        throw new AppError('Cổng thanh toán không hỗ trợ', 400, ERROR_CODES.VALIDATION_FAILED);
      }

      return sendSuccess(res, { payment_id: paymentId, checkout_url: checkoutUrl });
    } catch (err) { next(err); }
  }

  // ── 7.1.5 POST /billing/webhook/vnpay ──────────────────────────────────────
  static async vnPayWebhook(req: Request, res: Response, next: NextFunction) {
    try {
      let vnp_Params = req.body || req.query; // VNPay sends GET callback to return_url, but POST to IPN endpoint
      
      const secureHash = vnp_Params['vnp_SecureHash'];
      delete vnp_Params['vnp_SecureHash'];
      delete vnp_Params['vnp_SecureHashType'];

      vnp_Params = Object.keys(vnp_Params)
          .sort()
          .reduce((obj: any, key) => {
              obj[key] = vnp_Params[key];
              return obj;
          }, {});

      const secretKey = process.env.VNPAY_HASHSECRET || 'VNPAY_DUMMY_SECRET';
      const signData = qs.stringify(vnp_Params, { encode: false });
      const hmac = crypto.createHmac('sha512', secretKey);
      const signed = hmac.update(Buffer.from(signData, 'utf-8')).digest('hex');     

      if (secureHash !== signed) {
        return res.status(200).json({ RspCode: '97', Message: 'Checksum failed' }); // VNPay standard response
      }

      const orderId = vnp_Params['vnp_TxnRef'];
      const responseCode = vnp_Params['vnp_ResponseCode'];
      const paymentDate = vnp_Params['vnp_PayDate']; // YYYYMMDDHHmmss format

      // Process fulfillment
      await BillingController.processFulfillment(orderId, responseCode === '00', vnp_Params);
      
      return res.status(200).json({ RspCode: '00', Message: 'Confirm Success' });
    } catch (err) { 
      res.status(200).json({ RspCode: '99', Message: 'Unknown error' });
    }
  }

  // ── 7.1.6 POST /billing/webhook/momo ───────────────────────────────────────
  static async momoWebhook(req: Request, res: Response, next: NextFunction) {
    try {
      const { orderId, resultCode } = req.body;
      const isSuccess = Number(resultCode) === 0;
      await BillingController.processFulfillment(orderId, isSuccess, req.body);
      return res.status(200).json({ message: 'Success' }); // MoMo doesn't have strict code format
    } catch (err) {
      res.status(500).json({ message: 'Unknown error' });
    }
  }

  // Fulfillment Logic
  private static async processFulfillment(gatewayTxnId: string, isSuccess: boolean, rawPayload: any) {
    const payment = await db.queryOne('SELECT id, status, user_id, note FROM payments WHERE gateway_txn_id = $1 FOR UPDATE', [gatewayTxnId]);
    if (!payment) return;
    if (payment.status !== 'pending') return; // Already processed!

    const client = await db.getClient();
    try {
      await client.query('BEGIN');

      if (!isSuccess) {
        await client.query(
          "UPDATE payments SET status = 'failed', gateway_response = $1, updated_at = NOW() WHERE id = $2",
          [JSON.stringify(rawPayload), payment.id]
        );
      } else {
        if (payment.note.startsWith('plan_id:')) {
          const planId = payment.note.replace('plan_id:', '');
          const plan = await db.queryOne('SELECT * FROM subscription_plans WHERE id = $1', [planId]);
          
          let expiresAt: Date;
          if (plan.billing_cycle === 'monthly') expiresAt = addMonths(new Date(), 1);
          else if (plan.billing_cycle === 'yearly') expiresAt = addYears(new Date(), 1);
          else expiresAt = addDays(new Date(), 36500); // lifetime

          await client.query("UPDATE subscriptions SET status = 'expired' WHERE user_id = $1 AND status = 'active'", [payment.user_id]);

          const subRow = await client.query<{ id: string }>(
            `INSERT INTO subscriptions (user_id, plan_id, status, expires_at)
             VALUES ($1, $2, 'active', $3) RETURNING id`,
            [payment.user_id, plan.id, expiresAt]
          );
          const subId = subRow.rows[0]!.id;

          await client.query(
            "UPDATE payments SET status = 'success', paid_at = NOW(), subscription_id = $1, gateway_response = $2, updated_at = NOW() WHERE id = $3",
            [subId, JSON.stringify(rawPayload), payment.id]
          );

          await client.query("UPDATE users SET plan = 'premium', plan_expires_at = $1 WHERE id = $2", [expiresAt, payment.user_id]);
          cache.del(`user:${payment.user_id}`);

        } else if (payment.note.startsWith('booking_id:')) {
          const bookingId = payment.note.replace('booking_id:', '');
          
          // Update Booking Status
          await client.query(
            "UPDATE bookings SET status = 'confirmed', updated_at = NOW() WHERE id = $1",
            [bookingId]
          );

          // Update Payment Status
          await client.query(
            "UPDATE payments SET status = 'success', paid_at = NOW(), gateway_response = $1, updated_at = NOW() WHERE id = $2",
            [JSON.stringify(rawPayload), payment.id]
          );

          // Notify Tutor and Student
          const booking = await client.query(`
            SELECT b.tutor_id, b.student_id, b.session_date, b.start_time, tp.user_id as tutor_user_id
            FROM bookings b
            JOIN tutor_profiles tp ON b.tutor_id = tp.id
            WHERE b.id = $1
          `, [bookingId]);

          if (booking.rowCount && booking.rowCount > 0) {
            const b = booking.rows[0];
            const msg = `Lịch hẹn ngày ${b.session_date} lúc ${b.start_time} đã được thanh toán thành công.`;
            
            // Notification for Tutor
            await NotificationService.createNotification(
              b.tutor_user_id, 'booking_confirmed', 'Bạn có lịch dạy mới', msg, { booking_id: bookingId }
            );
            // Notification for Student
            await NotificationService.createNotification(
              b.student_id, 'booking_confirmed', 'Thanh toán buổi học thành công', msg, { booking_id: bookingId }
            );

            // TODO: In a real app, send actual Email via EmailService here
          }
        }
      }

      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  // ── 7.1.7 GET /billing/history ──────────────────────────────────────────────
  static async getHistory(req: Request, res: Response, next: NextFunction) {
    try {
      const user = req.user!;
      const { rows } = await db.query(
        `SELECT p.id, p.amount_vnd, p.currency, p.gateway, p.status, p.paid_at, sp.display_name as plan_name 
         FROM payments p 
         LEFT JOIN subscriptions s ON p.subscription_id = s.id 
         LEFT JOIN subscription_plans sp ON s.plan_id = sp.id
         WHERE p.user_id = $1 ORDER BY p.created_at DESC`,
        [user.id]
      );
      return sendSuccess(res, { items: rows });
    } catch (err) { next(err); }
  }

  // ── 7.1.10 POST /billing/approve ──────────────────────────────────────────
  static async approvePayment(req: Request, res: Response, next: NextFunction) {
    try {
      const user = req.user!;
      if (user.role !== 'admin') throw new AppError('Không có quyền truy cập', 403, ERROR_CODES.FORBIDDEN);
      
      const { payment_id } = req.body;
      const payment = await db.queryOne('SELECT id, gateway_txn_id FROM payments WHERE id = $1', [payment_id]);
      if (!payment) throw new AppError('Không tìm thấy giao dịch', 404, ERROR_CODES.RESOURCE_NOT_FOUND);
      
      await BillingController.processFulfillment(payment.gateway_txn_id, true, { approved_by: user.id, approved_at: new Date() });
      
      return sendSuccess(res, { message: 'Đã duyệt thanh toán thành công' });
    } catch (err) { next(err); }
  }

  // ── 7.1.11 GET /billing/admin/payments ─────────────────────────────────────
  static async getAllPayments(req: Request, res: Response, next: NextFunction) {
    try {
      const user = req.user!;
      if (user.role !== 'admin') throw new AppError('Không có quyền truy cập', 403, ERROR_CODES.FORBIDDEN);

      const { rows } = await db.query(
        `SELECT p.*, u.full_name as user_name, u.email as user_email
         FROM payments p
         JOIN users u ON p.user_id = u.id
         ORDER BY (p.status = 'pending') DESC, p.created_at DESC`
      );
      return sendSuccess(res, { items: rows });
    } catch (err) { next(err); }
  }

  // ── 7.1.8 POST /billing/subscription/cancel ────────────────────────────────
  static async cancelSubscription(req: Request, res: Response, next: NextFunction) {
    try {
      const user = req.user!;
      const existing = await db.queryOne(
        "SELECT id, auto_renew FROM subscriptions WHERE user_id = $1 AND status = 'active'",
        [user.id]
      );
      if (!existing) throw new AppError('Bạn không có gói Premium nào đang hoạt động.', 404, ERROR_CODES.RESOURCE_NOT_FOUND);
      if (!existing.auto_renew) throw new AppError('Gói cước đã huỷ gia hạn từ trước.', 400, ERROR_CODES.VALIDATION_FAILED);

      await db.query("UPDATE subscriptions SET auto_renew = FALSE, cancelled_at = NOW() WHERE id = $1", [existing.id]);
      
      return sendSuccess(res, { message: 'Đã hủy gia hạn tự động. Bạn vẫn giữ quyền lợi Premium đến hết chu kỳ.' });
    } catch (err) { next(err); }
  }

  // ── 7.1.9 GET /billing/pending ─────────────────────────────────────────────
  static async getPending(req: Request, res: Response, next: NextFunction) {
    try {
      const user = req.user!;
      const { plan_id } = req.query;
      
      let queryStr = "SELECT id, status, created_at FROM payments WHERE user_id = $1 AND status = 'pending' AND gateway = 'manual'";
      const params = [user.id];
      
      if (plan_id) {
        queryStr += " AND note LIKE $2";
        params.push(`%plan_id:${plan_id}%`);
      }
      
      const { rows } = await db.query(queryStr + " ORDER BY created_at DESC LIMIT 1", params);
      return sendSuccess(res, { pending: rows.length > 0 ? rows[0] : null });
    } catch (err) { next(err); }
  }

  // ── 10.1.6 POST /billing/booking/:booking_id/pay ───────────────────────────
  static async payBooking(req: Request, res: Response, next: NextFunction) {
    try {
      const user = req.user!;
      const { booking_id } = req.params;
      const { return_url } = req.body;

      const booking = await db.queryOne('SELECT id, price_vnd, status FROM bookings WHERE id = $1 AND student_id = $2', [booking_id, user.id]);
      if (!booking) throw new AppError('Không tìm thấy lịch hẹn', 404, ERROR_CODES.RESOURCE_NOT_FOUND);
      if (booking.status !== 'pending') throw new AppError('Buổi học này đã được thanh toán hoặc không hợp lệ', 400, ERROR_CODES.VALIDATION_FAILED);

      const gateway = 'vnpay';
      const orderId = `B_${booking.id.split('-')[0]}_${Date.now()}`;

      // We won't insert into payments table for bookings right now to keep it isolated,
      // Or we can insert into payments and map 'note' to 'booking_id:xxx'.
      const client = await db.getClient();
      let paymentId: string;
      try {
        await client.query('BEGIN');
        const pRow = await client.query<{ id: string }>(
          `INSERT INTO payments (user_id, amount_vnd, gateway, gateway_txn_id, note)
           VALUES ($1, $2, $3, $4, $5) RETURNING id`,
          [user.id, booking.price_vnd, gateway, orderId, `booking_id:${booking.id}`]
        );
        paymentId = pRow.rows[0]!.id;
        await client.query('COMMIT');
      } catch (err) {
        await client.query('ROLLBACK');
        throw err;
      } finally {
        client.release();
      }

      // Generate Checkout URL
      const ipAddr = req.headers['x-forwarded-for'] || req.socket.remoteAddress || '127.0.0.1';
      const defaultReturnUrl = `${process.env.APP_URL || 'http://localhost:3000'}/tutor/booking/vnpay_return`;
      const checkoutUrl = createVnPayUrl(ipAddr as string, orderId, booking.price_vnd, return_url || defaultReturnUrl);

      return sendSuccess(res, { payment_id: paymentId, checkout_url: checkoutUrl });
    } catch (err) { next(err); }
  }

}
