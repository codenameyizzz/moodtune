export interface Recommendation {
  title: string;
  creator: string;
  description: string;
  type: 'song' | 'movie' | 'book';
  links?: {
    spotify?: string;
    youtube?: string;
    primary?: 'spotify' | 'youtube';
  };
  preview?: {
    matchedTitle?: string;
    matchedArtist?: string;
    albumTitle?: string | null;
    artworkUrl?: string | null;
    musicbrainzUrl?: string | null;
    matchScore?: number | null;
  } | null;
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
