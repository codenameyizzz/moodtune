const cache = new Map();
let nextMusicBrainzRequestAt = 0;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function normalizeText(value) {
  return String(value || '').trim();
}

function buildSearchQuery(title, artist) {
  return encodeURIComponent(`${normalizeText(title)} ${normalizeText(artist)}`);
}

export function buildSpotifySearchUrl(title, artist) {
  return `https://open.spotify.com/search/${buildSearchQuery(title, artist)}`;
}

export function buildYoutubeSearchUrl(title, artist) {
  return `https://www.youtube.com/results?search_query=${buildSearchQuery(title, artist)}`;
}

async function musicBrainzFetchJson(url) {
  const now = Date.now();
  const waitMs = Math.max(0, nextMusicBrainzRequestAt - now);
  nextMusicBrainzRequestAt = Math.max(now, nextMusicBrainzRequestAt) + 1100;

  if (waitMs > 0) {
    await sleep(waitMs);
  }

  const response = await fetch(url, {
    headers: {
      'User-Agent': 'MoodTune/1.0 (contact: localhost)',
      Accept: 'application/json',
    },
  });

  if (!response.ok) {
    throw new Error(`MusicBrainz request failed with status ${response.status}`);
  }

  return response.json();
}

function pickBestRecording(payload) {
  if (!payload || !Array.isArray(payload.recordings)) {
    return null;
  }

  return payload.recordings.find(
    (recording) => Array.isArray(recording.releases) && recording.releases.length > 0,
  ) || payload.recordings[0] || null;
}

function extractPreview(recording, fallbackTitle, fallbackArtist) {
  const primaryRelease = recording?.releases?.[0];
  const releaseGroup = primaryRelease?.['release-group'];
  const artistCredit = Array.isArray(recording?.['artist-credit'])
    ? recording['artist-credit'].map((entry) => entry.name).join(', ')
    : fallbackArtist;

  return {
    matchedTitle: recording?.title || fallbackTitle,
    matchedArtist: artistCredit || fallbackArtist,
    albumTitle: primaryRelease?.title || null,
    artworkUrl: releaseGroup?.id
      ? `https://coverartarchive.org/release-group/${releaseGroup.id}/front-250`
      : null,
    musicbrainzUrl: recording?.id ? `https://musicbrainz.org/recording/${recording.id}` : null,
    matchScore: typeof recording?.score === 'number' ? recording.score : null,
  };
}

export async function lookupMusicPreview(titleInput, artistInput) {
  const title = normalizeText(titleInput);
  const artist = normalizeText(artistInput);

  if (!title || !artist) {
    return {
      ok: false,
      status: 400,
      body: { error: 'Both title and artist are required.' },
    };
  }

  const cacheKey = `${title.toLowerCase()}::${artist.toLowerCase()}`;
  if (cache.has(cacheKey)) {
    return {
      ok: true,
      status: 200,
      body: cache.get(cacheKey),
    };
  }

  try {
    const query = encodeURIComponent(`recording:"${title}" AND artist:"${artist}"`);
    const url = `https://musicbrainz.org/ws/2/recording?query=${query}&fmt=json&limit=1`;
    const payload = await musicBrainzFetchJson(url);
    const recording = pickBestRecording(payload);

    const result = {
      spotifyUrl: buildSpotifySearchUrl(title, artist),
      youtubeUrl: buildYoutubeSearchUrl(title, artist),
      preview: recording ? extractPreview(recording, title, artist) : null,
    };

    cache.set(cacheKey, result);
    return {
      ok: true,
      status: 200,
      body: result,
    };
  } catch (error) {
    console.error('Music metadata lookup failed.', error);
    return {
      ok: false,
      status: 502,
      body: {
        error: 'Music metadata lookup failed.',
        spotifyUrl: buildSpotifySearchUrl(title, artist),
        youtubeUrl: buildYoutubeSearchUrl(title, artist),
      },
    };
  }
}
