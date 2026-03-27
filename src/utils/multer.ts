import multer, { FileFilterCallback } from 'multer';
import { Request } from 'express';

/**
 * In-memory multer config for uploads that go directly to Cloudinary.
 * Max 5MB for images, 10MB for documents.
 */
export const imageUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB
  fileFilter(_req: Request, file: Express.Multer.File, cb: FileFilterCallback) {
    const allowed = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
    if (allowed.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Chỉ chấp nhận file ảnh JPG, PNG, WebP hoặc GIF'));
    }
  },
});

export const documentUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB
  fileFilter(_req: Request, file: Express.Multer.File, cb: FileFilterCallback) {
    const allowed = ['application/pdf', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'];
    if (allowed.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Chỉ chấp nhận file PDF hoặc DOCX'));
    }
  },
});
