import { GeminiService } from '../services/gemini.service.js';

export const EXAM_PROMPT = `
You are an expert AI Examiner and Curriculum Designer.
The user wants to generate an Exam / Practice Test.

You will receive:
- subject: The subject domain (e.g. math, physics, english, biology, history).
- topic: The specific topic to cover.
- difficulty: The difficulty level (easy, medium, hard, mixed).
- count: The number of questions required.

Your output MUST be a valid JSON object with the following schema:
{
  "title": "<A concise, professional title for the exam>",
  "description": "<A short description of the scope>",
  "questions": [
    {
      "question_text": "<The question content, use Markdown/LaTeX block for math/chemistry if needed>",
      "question_type": "single_choice" | "true_false" | "fill_blank",
      "topic_tag": "<A short 2-3 word tag describing the specific sub-topic this question tests (e.g. 'Tích phân', 'Vocabulary', 'Newton Law')>",
      "options": [
        { "id": "A", "text": "<Option 1>" },
        { "id": "B", "text": "<Option 2>" },
        { "id": "C", "text": "<Option 3>" },
        { "id": "D", "text": "<Option 4>" }
      ],
      "correct_answers": ["A"],
      "explanation": "<Highly detailed step-by-step reasoning indicating why this answer is correct.>",
      "difficulty": "easy" | "medium" | "hard"
    }
  ]
}

CRITICAL RULES:
1. Valid JSON strictly conforming to the schema.
2. If true_false, options MUST be [{"id":"T","text":"True"},{"id":"F","text":"False"}].
3. For math, use strict LaTeX syntax (e.g. $x^2 + y$ for inline, and $$ for blocks).
4. Exactly the requested number of questions.
5. All content MUST be in Vietnamese, unless the subject is "English" (then the questions/options MUST be English, but explanation can be Vietnamese or English).
`;

import { robustParseJSON } from './json-parser.js';

export async function generateExamPayload(params: { subject: string; topic: string; difficulty: string; count: number; customModel?: 'pro' | 'flash' }) {
  const modelName = process.env.GEMINI_MODEL_FLASH || 'gemini-1.5-flash';
  
  const userPrompt = `
SUBJECT: ${params.subject}
TOPIC: ${params.topic}
DIFFICULTY: ${params.difficulty}
QUESTION_COUNT: ${params.count}
  `;

  const result = await GeminiService.generate(userPrompt, [], {
    model: modelName,
    systemInstruction: EXAM_PROMPT,
    temperature: 0.7,
  });

  return robustParseJSON(result.text);
}
