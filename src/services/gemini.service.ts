import { GoogleGenerativeAI, HarmBlockThreshold, HarmCategory, GenerateContentResult } from '@google/generative-ai';
import logger from '../utils/logger.js';

// ──────────────────────────────────────────────────────────────
// Types
// ──────────────────────────────────────────────────────────────
export interface GeminiOptions {
  model?: string;
  temperature?: number;
  maxOutputTokens?: number;
  systemInstruction?: string;
  timeoutMs?: number;
}

export interface GeminiFilePart {
  type: 'image' | 'document';
  mimeType: 'image/jpeg' | 'image/png' | 'image/webp' | 'application/pdf';
  data: string; // base64
}

export interface GeminiResult {
  text: string;
  tokensUsed: number;
  modelVersion: string;
  durationMs: number;
}

// ──────────────────────────────────────────────────────────────
// Safety settings — allow educational content (math, science)
// ──────────────────────────────────────────────────────────────
const SAFETY_SETTINGS = [
  { category: HarmCategory.HARM_CATEGORY_HARASSMENT,          threshold: HarmBlockThreshold.BLOCK_ONLY_HIGH },
  { category: HarmCategory.HARM_CATEGORY_HATE_SPEECH,         threshold: HarmBlockThreshold.BLOCK_ONLY_HIGH },
  { category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT,   threshold: HarmBlockThreshold.BLOCK_ONLY_HIGH },
  { category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT,   threshold: HarmBlockThreshold.BLOCK_ONLY_HIGH },
];

// ──────────────────────────────────────────────────────────────
// Retry helper with exponential backoff
// ──────────────────────────────────────────────────────────────
async function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * 3.1.2 + 3.1.3 — GeminiService
 * Wraps @google/generative-ai with:
 *  - 30s timeout with AbortSignal
 *  - 429 → wait 60s → retry once
 *  - 500/503 → retry 1 time immediately
 *  - Invalid/empty JSON → retry up to 2 times
 *  - Detailed logging for all errors
 */
export class GeminiService {
  private static genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY!);

  /**
   * Core generate function.
   * @param prompt  Text prompt (may include instructions)
   * @param parts   Optional multimodal image parts
   * @param options Model/temperature/timeout overrides
   */
  static async generate(
    prompt: string,
    parts: GeminiFilePart[] = [],
    options: GeminiOptions = {}
  ): Promise<GeminiResult> {
    const modelName   = options.model           ?? process.env.GEMINI_MODEL_FLASH ?? process.env.GEMINI_MODEL ?? 'gemini-2.5-flash';
    const temperature = options.temperature     ?? 0.3;
    const maxTokens   = options.maxOutputTokens ?? 8192;
    const timeoutMs   = options.timeoutMs       ?? 30_000;

    const model = GeminiService.genAI.getGenerativeModel({
      model: modelName,
      safetySettings: SAFETY_SETTINGS,
      generationConfig: { temperature, maxOutputTokens: maxTokens },
      ...(options.systemInstruction ? { systemInstruction: options.systemInstruction } : {}),
    });

    const contents: any[] = [{ text: prompt }];
    for (const part of parts) {
      contents.push({ inlineData: { mimeType: part.mimeType, data: part.data } });
    }

    // Attempt with retry strategy
    const MAX_RETRIES = 3;
    let lastError: unknown;

    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
      try {
        const startTime = Date.now();

        // Timeout wrapper — use model.generateContent with directly passed parts array
        const callPromise = model.generateContent(contents);
        const timeoutPromise = new Promise<never>((_, reject) =>
          setTimeout(() => reject(Object.assign(new Error(`Gemini timeout after ${timeoutMs}ms`), { code: 'TIMEOUT' })), timeoutMs)
        );

        const result: GenerateContentResult = await Promise.race([callPromise, timeoutPromise]);
        const durationMs = Date.now() - startTime;

        const candidate = result.response.candidates?.[0];
        const text = candidate?.content?.parts?.[0]?.text ?? '';

        if (!text && attempt < MAX_RETRIES - 1) {
          // Empty response — retry
          logger.warn(`GeminiService: empty response on attempt ${attempt + 1}, retrying...`);
          lastError = new Error('Empty response from Gemini');
          await sleep(1000 * (attempt + 1));
          continue;
        }

        const tokensUsed = result.response.usageMetadata?.totalTokenCount ?? 0;

        logger.info(`GeminiService: success on attempt ${attempt + 1} | ${tokensUsed} tokens | ${durationMs}ms`);
        return { text, tokensUsed, modelVersion: modelName, durationMs };

      } catch (err: any) {
        lastError = err;
        const statusCode = err?.status ?? err?.code ?? 0;

        // 429 Rate Limited — wait 60 seconds before final retry
        if (statusCode === 429) {
          if (attempt < MAX_RETRIES - 1) {
            logger.warn(`GeminiService: 429 rate-limited. Waiting 15s before retry...`);
            await sleep(15_000);
            continue;
          }
        }

        // 500 / 503 Server Error — quick retry once
        if (statusCode === 500 || statusCode === 503) {
          if (attempt < MAX_RETRIES - 1) {
            logger.warn(`GeminiService: ${statusCode} server error. Retrying in 2s...`);
            await sleep(2000);
            continue;
          }
        }

        // Timeout — do not retry
        if (err?.code === 'TIMEOUT') {
          logger.error(`GeminiService: Request timed out after ${timeoutMs}ms`);
          throw Object.assign(new Error('AI request timed out. Please try again.'), {
            statusCode: 504,
            code: 'AI_TIMEOUT',
          });
        }

        // Unknown — propagate immediately
        logger.error(`GeminiService: Unknown error on attempt ${attempt + 1}:`, err);
        throw err;
      }
    }

    // All retries exhausted
    logger.error('GeminiService: All retries exhausted');
    throw lastError ?? new Error('Gemini API failed after retries');
  }

  /**
   * Convenience: generate from a URL image (downloaded by Gemini directly via fileData)
   * Uses Gemini's native URL support for Cloudinary-hosted images.
   */
  static async generateWithImageUrl(
    prompt: string,
    imageUrl: string,
    mimeType: GeminiFilePart['mimeType'] = 'image/jpeg',
    options: GeminiOptions = {}
  ): Promise<GeminiResult> {
    const modelName   = options.model           ?? process.env.GEMINI_MODEL_FLASH ?? process.env.GEMINI_MODEL ?? 'gemini-1.5-flash';
    const temperature = options.temperature     ?? 0.3;
    const maxTokens   = options.maxOutputTokens ?? 8192;
    const timeoutMs   = options.timeoutMs       ?? 30_000;

    const model = GeminiService.genAI.getGenerativeModel({
      model: modelName,
      safetySettings: SAFETY_SETTINGS,
      generationConfig: { temperature, maxOutputTokens: maxTokens },
      ...(options.systemInstruction ? { systemInstruction: options.systemInstruction } : {}),
    });

    const partsArr: any[] = [
      { text: prompt },
      { fileData: { mimeType, fileUri: imageUrl } },
    ];

    const startTime = Date.now();
    const callPromise = model.generateContent(partsArr);
    const timeoutPromise = new Promise<never>((_, reject) =>
      setTimeout(() => reject(Object.assign(new Error(`Gemini timeout`), { code: 'TIMEOUT' })), timeoutMs)
    );
    const result = await Promise.race([callPromise, timeoutPromise]);
    const durationMs = Date.now() - startTime;

    const text = result.response.candidates?.[0]?.content?.parts?.[0]?.text ?? '';
    const tokensUsed = result.response.usageMetadata?.totalTokenCount ?? 0;

    return { text, tokensUsed, modelVersion: modelName, durationMs };
  }
}
