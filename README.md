<div align="center">
<img width="1200" height="475" alt="GHBanner" src="https://github.com/user-attachments/assets/0aa67016-6eaf-458a-adb2-6e31a0763ed6" />
</div>

# MoodTune

MoodTune is a Vite + React app that analyzes the mood of a photo with Gemini, then recommends songs, books, and movies that match the detected vibe.

View the original AI Studio app: https://ai.studio/apps/fc8a7f0e-f2f4-4759-80a4-ab60bb195a91

## Requirements

- Node.js 22 or newer
- npm 10 or newer
- A valid Gemini API key

## Local Setup

1. Install dependencies:
   `npm install`
2. Create `.env.local` in the project root:
   ```env
   GEMINI_API_KEY=your_gemini_api_key
   ```
3. Start the development server:
   `npm run dev`
4. Open the local URL printed by Vite.

By default the app tries port `3000`. If that port is already in use, Vite will automatically choose the next available port, such as `3001`.

## Available Scripts

- `npm run dev`: start the local development server
- `npm run build`: create a production build in `dist/`
- `npm run preview`: serve the production build locally
- `npm run lint`: run TypeScript type-checking
- `npm run clean`: remove `dist/` in a cross-platform way

## Notes

- The current implementation injects `GEMINI_API_KEY` into the frontend bundle through Vite config. That is acceptable for local testing, but not a production-safe design. For production, move Gemini calls behind a backend endpoint and keep the API key server-side.
- Camera access requires browser permission.
