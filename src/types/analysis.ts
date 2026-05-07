export interface Recommendation {
  title: string;
  creator: string;
  description: string;
  type: 'song' | 'movie' | 'book';
}

export interface MoodAnalysis {
  mood: string;
  colors: string[];
  vibe: string;
  recommendations: Recommendation[];
  source: 'gemini' | 'local';
  sourceLabel: string;
  warning?: string;
}
