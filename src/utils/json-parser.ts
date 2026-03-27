/**
 * Robustly parses a JSON string from an AI response.
 * Handles cases where the AI wraps JSON in markdown blocks (e.g. ```json ... ```)
 * or adds leading/trailing text.
 */
export function robustParseJSON(text: string): any {
  // 1. Try direct parse first
  try {
    return JSON.parse(text);
  } catch (e) {
    // 2. Try to extract content between first { or [ and last } or ]
    const jsonMatch = text.match(/[\{\[]([\s\S]*)[\}\]]/);
    if (jsonMatch) {
      const cleaned = jsonMatch[0].trim();
      try {
        return JSON.parse(cleaned);
      } catch (e2) {
        // 3. Last resort: remove triple backticks and try again
        const stripped = text.replace(/```json/g, '').replace(/```/g, '').trim();
        try {
            return JSON.parse(stripped);
        } catch (e3) {
            console.error("AI JSON Parsing Failed:", text);
            throw e3;
        }
      }
    }
    throw e;
  }
}
