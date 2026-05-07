import { Recommendation } from '../types/analysis';

const MUSIC_API_BASE = (import.meta.env.VITE_MUSIC_API_BASE || '').replace(/\/$/, '');

type MusicLookupResponse = {
  spotifyUrl?: string;
  youtubeUrl?: string;
  preview?: Recommendation['preview'];
};

function buildSearchQuery(recommendation: Recommendation) {
  return encodeURIComponent(`${recommendation.title} ${recommendation.creator}`);
}

function buildFallbackLinks(recommendation: Recommendation) {
  return {
    spotify: `https://open.spotify.com/search/${buildSearchQuery(recommendation)}`,
    youtube: `https://www.youtube.com/results?search_query=${buildSearchQuery(recommendation)}`,
    primary: 'spotify' as const,
  };
}

export function getRecommendationLinks(recommendation: Recommendation) {
  return recommendation.links ?? buildFallbackLinks(recommendation);
}

async function enrichSongRecommendation(recommendation: Recommendation): Promise<Recommendation> {
  try {
    const params = new URLSearchParams({
      title: recommendation.title,
      artist: recommendation.creator,
    });
    const response = await fetch(`${MUSIC_API_BASE}/api/music/lookup?${params.toString()}`);
    if (!response.ok) {
      throw new Error(`Music lookup failed with status ${response.status}`);
    }

    const payload = (await response.json()) as MusicLookupResponse;
    return {
      ...recommendation,
      links: {
        spotify: payload.spotifyUrl,
        youtube: payload.youtubeUrl,
        primary: payload.spotifyUrl ? 'spotify' : 'youtube',
      },
      preview: payload.preview ?? null,
    };
  } catch (error) {
    console.error('Song recommendation metadata enrichment failed.', error);
    return {
      ...recommendation,
      links: buildFallbackLinks(recommendation),
      preview: null,
    };
  }
}

export async function enrichMusicRecommendations(recommendations: Recommendation[]) {
  const enriched = await Promise.all(
    recommendations.map((recommendation) =>
      recommendation.type === 'song'
        ? enrichSongRecommendation(recommendation)
        : Promise.resolve(recommendation),
    ),
  );

  return enriched;
}
