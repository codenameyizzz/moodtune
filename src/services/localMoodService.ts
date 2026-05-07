import { MoodAnalysis, Recommendation } from '../types/analysis';

type PaletteColor = {
  name: string;
  rgb: [number, number, number];
};

type MoodProfile = {
  mood: string;
  vibe: string;
  recommendations: Recommendation[];
};

const PALETTE: PaletteColor[] = [
  { name: 'soft ivory', rgb: [245, 239, 230] },
  { name: 'warm amber', rgb: [214, 147, 75] },
  { name: 'dusty rose', rgb: [188, 125, 132] },
  { name: 'terracotta', rgb: [176, 96, 73] },
  { name: 'forest green', rgb: [55, 99, 75] },
  { name: 'sage green', rgb: [137, 160, 128] },
  { name: 'deep teal', rgb: [42, 101, 112] },
  { name: 'sky blue', rgb: [122, 177, 214] },
  { name: 'midnight blue', rgb: [43, 60, 92] },
  { name: 'lavender haze', rgb: [151, 133, 180] },
  { name: 'slate gray', rgb: [110, 118, 129] },
  { name: 'charcoal', rgb: [52, 52, 52] },
];

const RECOMMENDATIONS: Record<string, Recommendation[]> = {
  Joyful: [
    { title: 'Golden', creator: 'Harry Styles', description: 'Open-hearted and sunlit, with forward momentum.', type: 'song' },
    { title: 'Electric Feel', creator: 'MGMT', description: 'Playful energy with vivid, colorful movement.', type: 'song' },
    { title: 'Amelie', creator: 'Jean-Pierre Jeunet', description: 'Whimsical warmth and visual optimism.', type: 'movie' },
    { title: 'Little Miss Sunshine', creator: 'Jonathan Dayton & Valerie Faris', description: 'Messy joy held together by tenderness.', type: 'movie' },
    { title: 'The House in the Cerulean Sea', creator: 'TJ Klune', description: 'Gentle, bright, and emotionally generous.', type: 'book' },
    { title: 'Anxious People', creator: 'Fredrik Backman', description: 'Humane humor with heartfelt release.', type: 'book' },
  ],
  Reflective: [
    { title: 'Holocene', creator: 'Bon Iver', description: 'Quiet scale, memory, and inner space.', type: 'song' },
    { title: 'Motion Picture Soundtrack', creator: 'Radiohead', description: 'Soft melancholy with emotional distance.', type: 'song' },
    { title: 'Her', creator: 'Spike Jonze', description: 'Tender solitude and modern longing.', type: 'movie' },
    { title: 'Lost in Translation', creator: 'Sofia Coppola', description: 'Atmospheric stillness and emotional drift.', type: 'movie' },
    { title: 'Norwegian Wood', creator: 'Haruki Murakami', description: 'Nostalgic introspection with subdued ache.', type: 'book' },
    { title: "On Earth We're Briefly Gorgeous", creator: 'Ocean Vuong', description: 'Lyrical vulnerability and observation.', type: 'book' },
  ],
  Moody: [
    { title: 'Retrograde', creator: 'James Blake', description: 'Dark pressure with elegant emotional pull.', type: 'song' },
    { title: 'Nightcall', creator: 'Kavinsky', description: 'Nocturnal tension and cinematic cool.', type: 'song' },
    { title: 'Blade Runner 2049', creator: 'Denis Villeneuve', description: 'Brooding scale and neon isolation.', type: 'movie' },
    { title: 'Drive', creator: 'Nicolas Winding Refn', description: 'Stylized restraint with latent intensity.', type: 'movie' },
    { title: 'The Secret History', creator: 'Donna Tartt', description: 'Elegant darkness and psychological density.', type: 'book' },
    { title: 'Never Let Me Go', creator: 'Kazuo Ishiguro', description: 'Quiet dread wrapped in tenderness.', type: 'book' },
  ],
  Calm: [
    { title: 'Sunset Lover', creator: 'Petit Biscuit', description: 'Soft pulse and easy airiness.', type: 'song' },
    { title: 'Bloom', creator: 'The Paper Kites', description: 'Gentle warmth with spacious breathing room.', type: 'song' },
    { title: 'Paterson', creator: 'Jim Jarmusch', description: 'Minimal, patient, and quietly attentive.', type: 'movie' },
    { title: 'My Neighbor Totoro', creator: 'Hayao Miyazaki', description: 'Pastoral calm and childlike comfort.', type: 'movie' },
    { title: 'A Psalm for the Wild-Built', creator: 'Becky Chambers', description: 'Restorative, kind, and unhurried.', type: 'book' },
    { title: 'The Comfort Book', creator: 'Matt Haig', description: 'Soft reassurance without dramatic force.', type: 'book' },
  ],
  Energetic: [
    { title: 'Dog Days Are Over', creator: 'Florence + The Machine', description: 'Kinetic release and emotional lift.', type: 'song' },
    { title: 'Tongue Tied', creator: 'Grouplove', description: 'Restless movement with bright edges.', type: 'song' },
    { title: 'Spider-Man: Into the Spider-Verse', creator: 'Bob Persichetti, Peter Ramsey & Rodney Rothman', description: 'Bold rhythm, color, and momentum.', type: 'movie' },
    { title: 'Baby Driver', creator: 'Edgar Wright', description: 'Fast pacing and stylish propulsion.', type: 'movie' },
    { title: 'Tomorrow, and Tomorrow, and Tomorrow', creator: 'Gabrielle Zevin', description: 'Creative drive with emotional charge.', type: 'book' },
    { title: 'Project Hail Mary', creator: 'Andy Weir', description: 'High-energy problem solving and momentum.', type: 'book' },
  ],
  Fresh: [
    { title: 'Midnight City', creator: 'M83', description: 'Airy scale with sparkling motion.', type: 'song' },
    { title: 'Good Days', creator: 'SZA', description: 'Clean emotional release and lift.', type: 'song' },
    { title: 'The Secret Life of Walter Mitty', creator: 'Ben Stiller', description: 'Expansive, hopeful, and visually open.', type: 'movie' },
    { title: "Kiki's Delivery Service", creator: 'Hayao Miyazaki', description: 'Lightness, motion, and renewal.', type: 'movie' },
    { title: 'The Midnight Library', creator: 'Matt Haig', description: 'Reset energy with hopeful perspective.', type: 'book' },
    { title: 'The Anthropocene Reviewed', creator: 'John Green', description: 'Observant wonder with emotional clarity.', type: 'book' },
  ],
};

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function rgbToHsl(red: number, green: number, blue: number) {
  const r = red / 255;
  const g = green / 255;
  const b = blue / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const lightness = (max + min) / 2;
  const delta = max - min;

  if (delta === 0) {
    return { saturation: 0, lightness };
  }

  const saturation =
    lightness > 0.5 ? delta / (2 - max - min) : delta / (max + min);

  return { saturation, lightness };
}

function colorDistance(a: [number, number, number], b: [number, number, number]) {
  return Math.sqrt(
    (a[0] - b[0]) ** 2 +
    (a[1] - b[1]) ** 2 +
    (a[2] - b[2]) ** 2,
  );
}

function getClosestPaletteColor(rgb: [number, number, number]) {
  return PALETTE.reduce((closest, current) => {
    const currentDistance = colorDistance(rgb, current.rgb);
    const closestDistance = colorDistance(rgb, closest.rgb);
    return currentDistance < closestDistance ? current : closest;
  });
}

function pickMoodProfile(brightness: number, saturation: number, warmth: number): MoodProfile {
  if (brightness >= 0.68 && saturation >= 0.42 && warmth >= 0.05) {
    return {
      mood: 'Joyful',
      vibe: 'Bright tones and warm contrast create an upbeat, open, and welcoming atmosphere.',
      recommendations: RECOMMENDATIONS.Joyful,
    };
  }

  if (brightness <= 0.38 && saturation >= 0.28) {
    return {
      mood: 'Moody',
      vibe: 'Deeper shadows and denser color pull the image toward a cinematic, nocturnal mood.',
      recommendations: RECOMMENDATIONS.Moody,
    };
  }

  if (saturation <= 0.2) {
    return {
      mood: 'Reflective',
      vibe: 'Muted contrast and restrained color give the scene a thoughtful, inward-facing tone.',
      recommendations: RECOMMENDATIONS.Reflective,
    };
  }

  if (brightness >= 0.65 && warmth < 0.05) {
    return {
      mood: 'Fresh',
      vibe: 'Cool highlights and airy light make the scene feel clean, light, and forward-looking.',
      recommendations: RECOMMENDATIONS.Fresh,
    };
  }

  if (saturation >= 0.4) {
    return {
      mood: 'Energetic',
      vibe: 'The stronger color separation gives the image a lively pulse and visible momentum.',
      recommendations: RECOMMENDATIONS.Energetic,
    };
  }

  return {
    mood: 'Calm',
    vibe: 'Balanced light and gentle color keep the image steady, soft, and emotionally settled.',
    recommendations: RECOMMENDATIONS.Calm,
  };
}

function loadImage(source: string) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('Could not read image data for local fallback analysis.'));
    image.src = source;
  });
}

export async function analyzeMoodLocally(base64Image: string, warning?: string): Promise<MoodAnalysis> {
  const image = await loadImage(base64Image);
  const canvas = document.createElement('canvas');
  const context = canvas.getContext('2d');

  if (!context) {
    throw new Error('Canvas is not available for local fallback analysis.');
  }

  const sampleSize = 48;
  canvas.width = sampleSize;
  canvas.height = sampleSize;
  context.drawImage(image, 0, 0, sampleSize, sampleSize);

  const { data } = context.getImageData(0, 0, sampleSize, sampleSize);
  let totalBrightness = 0;
  let totalSaturation = 0;
  let totalWarmth = 0;
  const colorCounts = new Map<string, number>();

  for (let index = 0; index < data.length; index += 16) {
    const red = data[index];
    const green = data[index + 1];
    const blue = data[index + 2];
    const alpha = data[index + 3];

    if (alpha < 32) continue;

    const { saturation, lightness } = rgbToHsl(red, green, blue);
    totalBrightness += lightness;
    totalSaturation += saturation;
    totalWarmth += red - blue;

    const paletteColor = getClosestPaletteColor([red, green, blue]);
    colorCounts.set(paletteColor.name, (colorCounts.get(paletteColor.name) ?? 0) + 1);
  }

  const sampleCount = Math.max(
    1,
    Array.from(colorCounts.values()).reduce((sum, count) => sum + count, 0),
  );
  const brightness = clamp(totalBrightness / sampleCount, 0, 1);
  const saturation = clamp(totalSaturation / sampleCount, 0, 1);
  const warmth = clamp(totalWarmth / sampleCount / 255, -1, 1);
  const colors = Array.from(colorCounts.entries())
    .sort((left, right) => right[1] - left[1])
    .slice(0, 4)
    .map(([name]) => name);

  const profile = pickMoodProfile(brightness, saturation, warmth);

  return {
    mood: profile.mood,
    colors: colors.length > 0 ? colors : ['soft ivory', 'slate gray'],
    vibe: profile.vibe,
    recommendations: profile.recommendations,
    source: 'local',
    sourceLabel: 'Local fallback analysis',
    warning:
      warning ??
      'Gemini is unavailable, so the app used a local color-and-lighting fallback. Results stay usable, but are less nuanced than Gemini vision.',
  };
}
