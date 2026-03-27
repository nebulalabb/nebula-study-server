import sgMail from '@sendgrid/mail';
import ejs from 'ejs';
import path from 'path';
import { fileURLToPath } from 'url';
import { AppError, ERROR_CODES } from '../utils/AppError.js';
import logger from '../utils/logger.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Initialize SendGrid
const SENDGRID_API_KEY = process.env.SENDGRID_API_KEY;
if (SENDGRID_API_KEY) {
  sgMail.setApiKey(SENDGRID_API_KEY);
}

export interface EmailOptions {
  to: string;
  subject: string;
  template: 'verify-email' | 'reset-password';
  context: Record<string, any>;
}

export class EmailService {
  private static readonly FROM_EMAIL = process.env.FROM_EMAIL || 'noreply@nebulalab.vn';
  private static readonly FROM_NAME = 'NebulaLab.vn';

  /**
   * Send an email using a template
   */
  static async sendEmail(options: EmailOptions): Promise<void> {
    try {
      // 1. Render template
      const templatePath = path.join(__dirname, `../templates/${options.template}.ejs`);
      const html = await ejs.renderFile(templatePath, options.context);

      // 2. Prepare message
      const msg = {
        to: options.to,
        from: {
          email: this.FROM_EMAIL,
          name: this.FROM_NAME,
        },
        subject: options.subject,
        html: html,
      };

      // 3. Send (Mock if no API key)
      if (!SENDGRID_API_KEY) {
        logger.info(`[MOCK EMAIL] To: ${options.to} | Subject: ${options.subject}`);
        logger.debug(`[MOCK EMAIL CONTENT] Context: ${JSON.stringify(options.context)}`);
        return;
      }

      await sgMail.send(msg);
      logger.info(`Email sent successfully to ${options.to}`);

    } catch (err: any) {
      logger.error('Error sending email:', err);
      throw new AppError('Failed to send email', 500, ERROR_CODES.INTERNAL_SERVER_ERROR);
    }
  }
}
