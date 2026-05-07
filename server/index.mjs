import 'dotenv/config';
import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const app = express();
const port = Number(process.env.PORT || process.env.MUSIC_PROXY_PORT || 8787);
const cache = new Map();
let nextMusicBrainzRequestAt = 0;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..');
const distDir = path.join(projectRoot, 'dist');
const hasDist = fs.existsSync(distDir);

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function normalizeText(value) {
  return String(value || '').trim();
}

function buildSearchQuery(title, artist) {
  return encodeURIComponent(`${normalizeText(title)} ${normalizeText(artist)}`);
}

function buildSpotifySearchUrl(title, artist) {
  return `https://open.spotify.com/search/${buildSearchQuery(title, artist)}`;
}

function buildYoutubeSearchUrl(title, artist) {
  return `https://www.youtube.com/results?search_query=${buildSearchQuery(title, artist)}`;
}

function corsMiddleware(req, res, next) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return;
  }

  next();
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
      'User-Agent': 'MoodTune/1.0 (local dev contact: localhost)',
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

  return payload.recordings.find((recording) => Array.isArray(recording.releases) && recording.releases.length > 0)
    || payload.recordings[0]
    || null;
}

function extractPreview(recording, title, artist) {
  const primaryRelease = recording?.releases?.[0];
  const releaseGroup = primaryRelease?.['release-group'];
  const artistCredit = Array.isArray(recording?.['artist-credit'])
    ? recording['artist-credit'].map((entry) => entry.name).join(', ')
    : artist;

  return {
    matchedTitle: recording?.title || title,
    matchedArtist: artistCredit || artist,
    albumTitle: primaryRelease?.title || null,
    artworkUrl: releaseGroup?.id
      ? `https://coverartarchive.org/release-group/${releaseGroup.id}/front-250`
      : null,
    musicbrainzUrl: recording?.id ? `https://musicbrainz.org/recording/${recording.id}` : null,
    matchScore: typeof recording?.score === 'number' ? recording.score : null,
  };
}

app.use(corsMiddleware);

app.get('/api/health', (_req, res) => {
  res.json({ ok: true });
});

app.get('/api/music/lookup', async (req, res) => {
  const title = normalizeText(req.query.title);
  const artist = normalizeText(req.query.artist);

  if (!title || !artist) {
    res.status(400).json({ error: 'Both title and artist are required.' });
    return;
  }

  const cacheKey = `${title.toLowerCase()}::${artist.toLowerCase()}`;
  const cached = cache.get(cacheKey);
  if (cached) {
    res.json(cached);
    return;
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
    res.json(result);
  } catch (error) {
    console.error('Music metadata lookup failed.', error);
    res.status(502).json({
      error: 'Music metadata lookup failed.',
      spotifyUrl: buildSpotifySearchUrl(title, artist),
      youtubeUrl: buildYoutubeSearchUrl(title, artist),
    });
  }
});

if (hasDist) {
  app.use(express.static(distDir));

  app.get('*', (req, res, next) => {
    if (req.path.startsWith('/api/')) {
      next();
      return;
    }

    res.sendFile(path.join(distDir, 'index.html'));
  });
}

app.listen(port, () => {
  const mode = hasDist ? 'app + API server' : 'music metadata server';
  console.log(`MoodTune ${mode} listening on http://localhost:${port}`);
});
