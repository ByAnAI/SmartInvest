
import { GoogleGenAI, Type, GenerateContentResponse } from "@google/genai";
import { InsightResponse } from "../types";

const SYSTEM_INSTRUCTION = `You are a world-class senior investment advisor and financial analyst. 
Your goal is to provide objective, data-driven stock market insights. 
Analyze news, trends, and fundamentals. 
Always warn users that your advice is for informational purposes and they should do their own research.
When asked for specific analysis, focus on technical indicators, fundamental health, and market sentiment.`;

// Using gemini-3-pro-preview for complex analysis as per guidelines
export const getStockInsight = async (symbol: string): Promise<InsightResponse> => {
  const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
  const prompt = `Analyze the stock ticker ${symbol}. Provide market sentiment, a summary of recent performance, key pros and cons for investors, and a final recommendation with a confidence level. Return only a valid JSON object.`;

  const response = await ai.models.generateContent({
    model: 'gemini-3-pro-preview',
    contents: prompt,
    config: {
      systemInstruction: SYSTEM_INSTRUCTION,
      responseMimeType: "application/json",
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          sentiment: { type: Type.STRING, description: 'One of Bullish, Bearish, Neutral' },
          summary: { type: Type.STRING },
          pros: { type: Type.ARRAY, items: { type: Type.STRING } },
          cons: { type: Type.ARRAY, items: { type: Type.STRING } },
          recommendation: { type: Type.STRING },
          confidence: { type: Type.NUMBER, description: 'Percentage 0-100' }
        },
        required: ['sentiment', 'summary', 'pros', 'cons', 'recommendation', 'confidence']
      }
    }
  });

  const jsonStr = response.text?.trim();
  if (!jsonStr) {
    throw new Error("Failed to receive a valid analysis from AI");
  }

  try {
    return JSON.parse(jsonStr) as InsightResponse;
  } catch (e) {
    console.error("Failed to parse insight JSON", e);
    throw new Error("Invalid response format from AI");
  }
};

export const chatWithAdvisor = async (history: {role: string, parts: {text: string}[]}[], message: string) => {
  const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
  const chat = ai.chats.create({
    model: 'gemini-3-flash-preview',
    config: {
      systemInstruction: SYSTEM_INSTRUCTION,
    },
  });

  const response = await chat.sendMessage({ message });
  return response.text;
};

// Upgraded to extract grounding sources for Google Search as required by guidelines
export const getMarketNews = async () => {
  const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
  const response = await ai.models.generateContent({
    model: 'gemini-3-flash-preview',
    contents: "Provide a brief summary of the top 5 global market stories happening right now for a stock market dashboard. Include a sentiment (positive, negative, or neutral) for each.",
    config: {
      tools: [{ googleSearch: {} }]
    }
  });
  
  const text = response.text || '';
  const chunks = response.candidates?.[0]?.groundingMetadata?.groundingChunks || [];
  const sources = chunks.map((chunk: any) => chunk.web).filter(Boolean);
  
  return { text, sources };
};