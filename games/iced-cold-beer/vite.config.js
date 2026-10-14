import { defineConfig } from 'vite';

export default defineConfig({
  // relative asset paths so the build works from any folder (games.ope.cool/iced-cold-beer/, itch.io, etc.)
  base: './',
});
