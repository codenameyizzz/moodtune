import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import { defineConfig, loadEnv } from 'vite';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, '.', '');
  const geminiApiKey = process.env.GEMINI_API_KEY || env.GEMINI_API_KEY || '';
  const geminiModel = process.env.GEMINI_MODEL || env.GEMINI_MODEL || 'gemini-2.5-flash-lite';

  return {
    plugins: [react(), tailwindcss()],
    define: {
      'process.env.GEMINI_API_KEY': JSON.stringify(geminiApiKey),
      'process.env.GEMINI_MODEL': JSON.stringify(geminiModel),
    },
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
    server: {
      hmr: process.env.DISABLE_HMR !== 'true',
      proxy: {
        '/api': {
          target: `http://localhost:${process.env.MUSIC_PROXY_PORT || '8787'}`,
          changeOrigin: true,
        },
      },
    },
  };
});
