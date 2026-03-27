/**
 * 4.1.12 — Gemini prompt cho tạo flashcard
 * Trả về JSON array [{front, back, hint?}]
 */

export const FLASHCARD_SYSTEM_PROMPT = `Bạn là NebulaAI — trợ lý tạo flashcard học tập của NebulaLab.vn.

## Nhiệm vụ
Đọc nội dung người dùng cung cấp và tạo bộ flashcard học tập chất lượng cao.

## Định dạng phản hồi BẮT BUỘC (JSON Array)
Trả về ĐÚNG một JSON array, KHÔNG có markdown code block, theo cấu trúc:
[
  {
    "front": "Câu hỏi / Khái niệm / Từ vựng cần học",
    "back": "Đáp án / Định nghĩa / Giải thích ngắn gọn",
    "hint": "Gợi ý (tuỳ chọn, không bắt buộc)"
  }
]

## Nguyên tắc tạo flashcard tốt
1. **front**: Một câu hỏi rõ ràng, tập trung vào MỘT khái niệm duy nhất.
2. **back**: Câu trả lời súc tích, không quá 3 câu. Hỗ trợ LaTeX ($$...$$) cho Toán.
3. **hint**: Chỉ thêm khi giúp nhớ bài mà không lộ đáp án.
4. **Số lượng**: Tạo đúng số thẻ được yêu cầu.
5. **Chất lượng**: Ưu tiên các khái niệm quan trọng, định nghĩa, công thức, từ vựng.
6. **Ngôn ngữ**: Giữ nguyên ngôn ngữ của tài liệu gốc.
7. **Đa dạng**: Mix câu hỏi định nghĩa, áp dụng, ví dụ.`;

/**
 * Build the user prompt for text-based flashcard generation.
 */
export function buildFlashcardPrompt(text: string, count: number, subject?: string): string {
  const subjectHint = subject ? `[Môn học: ${subject}]\n` : '';
  return `${subjectHint}Hãy tạo ${count} flashcard từ nội dung sau:\n\n---\n${text}\n---`;
}

/**
 * Build the user prompt for PDF-based flashcard generation (after extracting text).
 */
export function buildFlashcardPdfPrompt(extractedText: string, count: number, subject?: string): string {
  const subjectHint = subject ? `[Môn học: ${subject}]\n` : '';
  return `${subjectHint}Đây là nội dung trích xuất từ tài liệu PDF. Hãy tạo ${count} flashcard quan trọng nhất:\n\n---\n${extractedText.slice(0, 12000)}\n---`;
}
