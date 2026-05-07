import { lookupMusicPreview } from '../../lib/musicLookup.js';

export async function GET(request: Request) {
  const url = new URL(request.url);
  const title = url.searchParams.get('title');
  const artist = url.searchParams.get('artist');
  const result = await lookupMusicPreview(title, artist);

  return Response.json(result.body, { status: result.status });
}
