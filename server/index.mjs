import 'dotenv/config';
import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { lookupMusicPreview } from '../lib/musicLookup.js';

const app = express();
const port = Number(process.env.PORT || process.env.MUSIC_PROXY_PORT || 8787);

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..');
const distDir = path.join(projectRoot, 'dist');
const hasDist = fs.existsSync(distDir);

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

app.use(corsMiddleware);

app.get('/api/health', (_req, res) => {
  res.json({ ok: true });
});

app.get('/api/music/lookup', async (req, res) => {
  const result = await lookupMusicPreview(req.query.title, req.query.artist);
  res.status(result.status).json(result.body);
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
