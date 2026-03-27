import nodemailer from 'nodemailer';
import ejs from 'ejs';
import path from 'path';
import { fileURLToPath } from 'url';
import { AppError, ERROR_CODES } from '../utils/AppError.js';
import logger from '../utils/logger.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// SMTP Configuration
const SMTP_HOST = process.env.SMTP_HOST;
const SMTP_PORT = parseInt(process.env.SMTP_PORT || '587');
const SMTP_USER = process.env.SMTP_USER;
const SMTP_PASS = process.env.SMTP_PASS;

const transporter = (SMTP_USER && SMTP_PASS) ? nodemailer.createTransport({
  host: SMTP_HOST || 'smtp.gmail.com',
  port: SMTP_PORT,
  secure: SMTP_PORT === 465,
  auth: {
    user: SMTP_USER,
    pass: SMTP_PASS,
  },
}) : null;

export interface EmailOptions {
  to: string;
  subject: string;
  template: 'verify-email' | 'reset-password' | 'flashcard-reminder';
  context: Record<string, any>;
}

export class EmailService {
  private static readonly FROM_EMAIL = process.env.FROM_EMAIL || 'noreply@nebulalab.vn';
  private static readonly FROM_NAME = 'NebulaStudy';

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
        from: `"${this.FROM_NAME}" <${this.FROM_EMAIL}>`,
        to: options.to,
        subject: options.subject,
        html: html,
      };

      // 3. Send (Mock if no SMTP config)
      if (!transporter) {
        logger.info(`[MOCK EMAIL] To: ${options.to} | Subject: ${options.subject}`);
        logger.debug(`[MOCK EMAIL CONTENT] Context: ${JSON.stringify(options.context)}`);
        return;
      }

      await transporter.sendMail(msg);
      logger.info(`Email sent successfully via Nodemailer to ${options.to}`);

    } catch (err: any) {
      logger.error('Error sending email via Nodemailer:', err);
      throw new AppError('Failed to send email', 500, ERROR_CODES.INTERNAL_SERVER_ERROR);
    }
  }
}
