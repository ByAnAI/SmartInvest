
import { GoogleGenAI, Type } from "@google/genai";
import { InsightResponse } from "../types";

const SYSTEM_INSTRUCTION = `You are a world-class senior investment advisor and financial analyst. 
Your goal is to provide objective, data-driven stock market insights. 
Analyze news, trends, and fundamentals. 
Always warn users that your advice is for informational purposes and they should do their own research.
When asked for specific analysis, focus on technical indicators, fundamental health, and market sentiment.`;
const GEMINI_MODEL = "gemini-2.5-flash-lite";
const INSIGHT_CACHE_TTL_MS = 10 * 60 * 1000;
const insightCache = new Map<string, { ts: number; data: InsightResponse }>();

const getGeminiApiKey = (): string => {
  const viteKey = (import.meta as any)?.env?.VITE_GEMINI_API_KEY;
  const viteCompatKey = (import.meta as any)?.env?.GEMINI_API_KEY;
  const nodeKey = (typeof process !== "undefined" ? (process as any)?.env?.API_KEY : undefined);
  const nodeCompatKey = (typeof process !== "undefined" ? (process as any)?.env?.GEMINI_API_KEY : undefined);
  const key = (viteKey || viteCompatKey || nodeKey || nodeCompatKey || "").trim();
  if (!key) {
    throw new Error("Missing Gemini API key. Set VITE_GEMINI_API_KEY (or GEMINI_API_KEY) in .env and restart npm run dev.");
  }
  return key;
};

export const getStockInsight = async (symbol: string, contextualPrompt?: string): Promise<InsightResponse> => {
  const ai = new GoogleGenAI({ apiKey: getGeminiApiKey() });
  const prompt = (contextualPrompt && contextualPrompt.trim())
    ? contextualPrompt
    : `Analyze the stock ticker ${symbol}. Provide market sentiment, a summary of recent performance, key pros and cons for investors, and a final recommendation with a confidence level. Return only a valid JSON object.`;
  const cacheKey = `${symbol.toUpperCase()}::${prompt}`;
  const now = Date.now();
  const cached = insightCache.get(cacheKey);
  if (cached && now - cached.ts < INSIGHT_CACHE_TTL_MS) {
    return cached.data;
  }

  const response = await ai.models.generateContent({
    model: GEMINI_MODEL,
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
    const parsed = JSON.parse(jsonStr) as InsightResponse;
    insightCache.set(cacheKey, { ts: now, data: parsed });
    return parsed;
  } catch (e) {
    console.error("Failed to parse insight JSON", e);
    throw new Error("Invalid response format from AI");
  }
};

export const getStockInsightsBatch = async (tickers: string[]): Promise<Record<string, string>> => {
  const normalized = tickers.map((t) => t.trim().toUpperCase()).filter(Boolean);
  if (!normalized.length) return {};

  const ai = new GoogleGenAI({ apiKey: getGeminiApiKey() });
  const prompt = [
    "Provide one concise sentence of current market insight per ticker.",
    "Tickers:",
    normalized.join(", "),
    'Return only valid JSON as: {"items":[{"ticker":"AAPL","insight":"..."}]}',
  ].join("\n");

  const response = await ai.models.generateContent({
    model: GEMINI_MODEL,
    contents: prompt,
    config: {
      systemInstruction: SYSTEM_INSTRUCTION,
      responseMimeType: "application/json",
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          items: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                ticker: { type: Type.STRING },
                insight: { type: Type.STRING },
              },
              required: ["ticker", "insight"],
            },
          },
        },
        required: ["items"],
      },
    },
  });

  const jsonStr = response.text?.trim();
  if (!jsonStr) return {};
  const parsed = JSON.parse(jsonStr) as { items?: Array<{ ticker: string; insight: string }> };
  const out: Record<string, string> = {};
  (parsed.items || []).forEach((item) => {
    const t = String(item?.ticker || "").toUpperCase();
    const insight = String(item?.insight || "").trim();
    if (t && insight) out[t] = insight;
  });
  return out;
};

export const chatWithAdvisor = async (history: {role: string, parts: {text: string}[]}[], message: string) => {
  const ai = new GoogleGenAI({ apiKey: getGeminiApiKey() });
  const chat = ai.chats.create({
    model: GEMINI_MODEL,
    config: {
      systemInstruction: SYSTEM_INSTRUCTION,
    },
  });

  const response = await chat.sendMessage({ message });
  return response.text;
};

// Upgraded to extract grounding sources for Google Search as required by guidelines
export const getMarketNews = async () => {
  const ai = new GoogleGenAI({ apiKey: getGeminiApiKey() });
  const response = await ai.models.generateContent({
    model: GEMINI_MODEL,
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