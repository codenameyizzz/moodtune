import { GoogleGenAI, Type } from '@google/genai';
import { MoodAnalysis } from '../types/analysis';
import { analyzeMoodLocally } from './localMoodService';

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY || '' });

type GeminiAnalysisPayload = Pick<
  MoodAnalysis,
  'mood' | 'colors' | 'vibe' | 'recommendations'
>;

function getFallbackWarning(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  const normalized = message.toLowerCase();

  if (
    normalized.includes('429') ||
    normalized.includes('quota') ||
    normalized.includes('rate limit')
  ) {
    return 'Gemini quota appears to be exhausted, so the app switched to a local fallback analysis.';
  }

  if (
    normalized.includes('api key') ||
    normalized.includes('permission') ||
    normalized.includes('403')
  ) {
    return 'Gemini authentication failed, so the app switched to a local fallback analysis.';
  }

  if (
    normalized.includes('network') ||
    normalized.includes('fetch') ||
    normalized.includes('failed to fetch')
  ) {
    return 'Gemini could not be reached over the network, so the app switched to a local fallback analysis.';
  }

  return 'Gemini is unavailable right now, so the app switched to a local fallback analysis.';
}

export async function analyzeMood(base64Image: string): Promise<MoodAnalysis> {
  if (!process.env.GEMINI_API_KEY) {
    return analyzeMoodLocally(
      base64Image,
      'Gemini API key is missing, so the app used the local fallback analysis.',
    );
  }

  const model = 'gemini-3-flash-preview';

  const prompt = `Analyze this image in terms of mood, emotional resonance, and visual atmosphere.
Focus on the vibe and colors.
Then, recommend 2 songs, 2 movies, and 2 books that align with this specific nuance.

Provide the response in JSON format.`;

  try {
    const response = await ai.models.generateContent({
      model,
      contents: [
        {
          parts: [
            { text: prompt },
            {
              inlineData: {
                mimeType: 'image/jpeg',
                data: base64Image.split(',')[1] || base64Image,
              },
            },
          ],
        },
      ],
      config: {
        responseMimeType: 'application/json',
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            mood: { type: Type.STRING, description: 'One word summary of the mood' },
            colors: {
              type: Type.ARRAY,
              items: { type: Type.STRING },
              description: "Dominant color names (e.g., 'deep teal', 'warm amber')",
            },
            vibe: { type: Type.STRING, description: 'A poetic description of the atmospheric nuance' },
            recommendations: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  title: { type: Type.STRING },
                  creator: { type: Type.STRING, description: 'Artist, Director, or Author' },
                  description: { type: Type.STRING, description: 'Why it fits this mood (max 15 words)' },
                  type: {
                    type: Type.STRING,
                    enum: ['song', 'movie', 'book'],
                  },
                },
                required: ['title', 'creator', 'description', 'type'],
              },
            },
          },
          required: ['mood', 'colors', 'vibe', 'recommendations'],
        },
      },
    });

    const parsed = JSON.parse(response.text.trim()) as GeminiAnalysisPayload;
    return {
      ...parsed,
      source: 'gemini',
      sourceLabel: 'Gemini vision analysis',
    };
  } catch (error) {
    console.error('Gemini analysis failed. Falling back to local analysis.', error);
    return analyzeMoodLocally(base64Image, getFallbackWarning(error));
  }
}
