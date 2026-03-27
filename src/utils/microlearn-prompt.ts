import { GeminiService } from '../services/gemini.service.js';
import { robustParseJSON } from './json-parser.js';

export const MICROLEARN_PROMPT = `
You are an expert Educational Content Creator. 
Your goal is to create a "Nebula Flash" lesson - a short, engaging, and highly informative lesson that takes exactly 5 minutes to read and understand.

You will receive:
- topic: The subject of the lesson.
- keywords: Specific points to cover (optional).
- difficulty: easy, medium, or hard.

Your output MUST be a valid JSON object with the following schema:
{
  "title": "<A catchy and informative title>",
  "content": "<The lesson content in Markdown format, between 150-300 words. Use headings, bullet points, and bold text for readability.>",
  "estimated_minutes": 5,
  "quiz_question": {
    "question": "<A single multiple-choice question testing the core concept of the lesson>",
    "options": [
      { "id": "A", "text": "<Option A>" },
      { "id": "B", "text": "<Option B>" },
      { "id": "C", "text": "<Option C>" },
      { "id": "D", "text": "<Option D>" }
    ],
    "correct": "A" | "B" | "C" | "D",
    "explanation": "<A short explanation of why the answer is correct>"
  }
}

CRITICAL RULES:
1. Content must be educational, accurate, and engaging.
2. Use Markdown for formatting (bold, italic, list, etc.).
3. The quiz must have exactly 4 choices (A, B, C, D).
4. All content MUST be in Vietnamese.
5. JSON must be strictly valid.
`;

export async function generateMicroLessonPayload(params: { topic: string; keywords?: string; difficulty: string }) {
  const modelName = process.env.GEMINI_MODEL_FLASH || 'gemini-1.5-flash';
  
  const userPrompt = `
TOPIC: ${params.topic}
KEYWORDS: ${params.keywords || 'N/A'}
DIFFICULTY: ${params.difficulty}
  `;

  const result = await GeminiService.generate(userPrompt, [], {
    model: modelName,
    systemInstruction: MICROLEARN_PROMPT,
    temperature: 0.7,
  });

  return robustParseJSON(result.text);
}
