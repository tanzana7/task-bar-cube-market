import { resolve } from 'node:path';
import { defineConfig } from 'vite';

// Build the isolated preview as a second HTML entry so it shares the tested UI
// code while keeping its demo JSON and localStorage keys away from production data.
export default defineConfig({
  build: {
    rollupOptions: {
      input: {
        main: resolve(process.cwd(), 'index.html'),
        watchlistPreview: resolve(process.cwd(), 'watchlist-preview.html'),
      },
    },
  },
});
