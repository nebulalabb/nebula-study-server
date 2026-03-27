import { GoogleGenerativeAI } from '@google/generative-ai';
import dotenv from 'dotenv';
dotenv.config();

async function listModels() {
  const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY!);
  try {
    // The SDK might not have a direct listModels, so we use fetch
    const apiKey = process.env.GEMINI_API_KEY!;
    const url = `https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`;
    
    const response = await fetch(url);
    const data = await response.json();
    
    if (data.models) {
        console.log("--- AVAILABLE MODELS ---");
        data.models.forEach((m: any) => {
            console.log(`- ${m.name.replace('models/', '')} (${m.supportedGenerationMethods.join(', ')})`);
        });
    } else {
        console.log("No models found or error:", data);
    }
  } catch (err) {
    console.error("Fetch failed:", err);
  }
}

listModels();
