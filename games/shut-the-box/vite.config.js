import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';

// the shared dice package (../../packages) is dependency-free: three and cannon-es come from this game
export default defineConfig({
  // relative asset paths so the build works from any folder (itch.io, GitHub Pages, etc.)
  base: './',
  server: { fs: { allow: ['../..'] } },
  resolve: { alias: { '@dice': fileURLToPath(new URL('../../packages/dice-physics/src/index.js', import.meta.url)) } },
  build: { chunkSizeWarningLimit: 1200 },
});
