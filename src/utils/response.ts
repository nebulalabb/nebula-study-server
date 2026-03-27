import { Response } from 'express';

/**
 * Standard Success Response Format
 */
export const sendSuccess = (res: Response, data: any, meta: any = {}, statusCode: number = 200) => {
  return res.status(statusCode).json({
    success: true,
    data,
    meta: {
      timestamp: new Date().toISOString(),
      ...meta,
    },
  });
};

/**
 * Standard Error Response Format
 */
export const sendError = (
  res: Response,
  code: string,
  message: string,
  statusCode: number = 400,
  details: any = null
) => {
  return res.status(statusCode).json({
    success: false,
    error: {
      code,
      message,
      details,
    },
  });
};
