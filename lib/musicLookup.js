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

async function itunesFetchJson(url) {
  const response = await fetch(url, {
    headers: {
      Accept: 'application/json',
    },
  });

  if (!response.ok) {
    throw new Error(`iTunes Search API request failed with status ${response.status}`);
  }

  return response.json();
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

function scoreItunesResult(result, title, artist) {
  const resultTitle = normalizeText(result?.trackName).toLowerCase();
  const resultArtist = normalizeText(result?.artistName).toLowerCase();
  const expectedTitle = normalizeText(title).toLowerCase();
  const expectedArtist = normalizeText(artist).toLowerCase();

  let score = 0;

  if (resultTitle === expectedTitle) score += 3;
  else if (resultTitle.includes(expectedTitle) || expectedTitle.includes(resultTitle)) score += 2;

  if (resultArtist === expectedArtist) score += 3;
  else if (resultArtist.includes(expectedArtist) || expectedArtist.includes(resultArtist)) score += 2;

  return score;
}

function pickBestItunesResult(payload, title, artist) {
  if (!payload || !Array.isArray(payload.results) || payload.results.length === 0) {
    return null;
  }

  return [...payload.results]
    .sort((left, right) => scoreItunesResult(right, title, artist) - scoreItunesResult(left, title, artist))[0];
}

async function lookupItunesPreview(title, artist) {
  const term = buildSearchQuery(title, artist);
  const url = `https://itunes.apple.com/search?term=${term}&media=music&entity=song&limit=5&country=US`;
  const payload = await itunesFetchJson(url);
  const bestMatch = pickBestItunesResult(payload, title, artist);

  if (!bestMatch) {
    return null;
  }

  return {
    audioPreviewUrl: bestMatch.previewUrl || null,
    appleMusicUrl: bestMatch.trackViewUrl || bestMatch.collectionViewUrl || null,
    artworkUrl: bestMatch.artworkUrl100 || bestMatch.artworkUrl60 || null,
    matchedTitle: bestMatch.trackName || title,
    matchedArtist: bestMatch.artistName || artist,
    albumTitle: bestMatch.collectionName || null,
    previewProvider: bestMatch.previewUrl ? 'itunes' : null,
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
    const [musicBrainzPayload, itunesPreview] = await Promise.all([
      musicBrainzFetchJson(url),
      lookupItunesPreview(title, artist).catch((error) => {
        console.error('iTunes preview lookup failed.', error);
        return null;
      }),
    ]);
    const recording = pickBestRecording(musicBrainzPayload);
    const musicBrainzPreview = recording ? extractPreview(recording, title, artist) : null;

    const preview = musicBrainzPreview || itunesPreview
      ? {
          ...(musicBrainzPreview || {}),
          ...(itunesPreview ? {
            matchedTitle: itunesPreview.matchedTitle || musicBrainzPreview?.matchedTitle,
            matchedArtist: itunesPreview.matchedArtist || musicBrainzPreview?.matchedArtist,
            albumTitle: itunesPreview.albumTitle || musicBrainzPreview?.albumTitle || null,
            artworkUrl: musicBrainzPreview?.artworkUrl || itunesPreview.artworkUrl || null,
            audioPreviewUrl: itunesPreview.audioPreviewUrl || null,
            previewProvider: itunesPreview.previewProvider,
          } : {}),
        }
      : null;

    const result = {
      spotifyUrl: buildSpotifySearchUrl(title, artist),
      youtubeUrl: buildYoutubeSearchUrl(title, artist),
      appleMusicUrl: itunesPreview?.appleMusicUrl || null,
      preview,
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
        appleMusicUrl: null,
      },
    };
  }
}
