import { EmailService } from '../services/email.service.js';
import logger from '../utils/logger.js';

export interface EmailJobData {
  to: string;
  name?: string;
  link: string;
  type: 'verify_email' | 'reset_password';
}

/**
 * Simple in-memory asynchronous email processing
 */
export const addEmailJob = async (data: EmailJobData) => {
  logger.info(`[Queue] Scheduling email to ${data.to} (${data.type})`);
  
  // Use setImmediate to process asynchronously without blocking the request
  setImmediate(async () => {
    try {
      const { to, name, link, type } = data;
      logger.info(`[Worker] Processing ${type} email for ${to}`);

      let subject = '';
      let template: 'verify-email' | 'reset-password' = 'verify-email';
      let context: any = { name, link };

      if (type === 'verify_email') {
        subject = '[NebulaLab.vn] Xác thực email của bạn';
        template = 'verify-email';
      } else if (type === 'reset_password') {
        subject = '[NebulaLab.vn] Đặt lại mật khẩu';
        template = 'reset-password';
      }

      await EmailService.sendEmail({
        to,
        subject,
        template,
        context,
      });
      
      logger.info(`[Worker] Email to ${to} sent successfully`);
    } catch (err) {
      logger.error(`[Worker] Failed to send email to ${data.to}:`, err);
    }
  });

  return { id: `mem_${Date.now()}` };
};
