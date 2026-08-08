import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

// Builds the side panel (React app). Background and content scripts are
// built separately (see vite.background.config.ts / vite.content.config.ts)
// because content scripts cannot be ES modules.
export default defineConfig({
  plugins: [react()],
  root: 'src/sidepanel',
  base: './',
  build: {
    outDir: path.resolve(__dirname, 'dist'),
    emptyOutDir: true,
    rollupOptions: {
      input: path.resolve(__dirname, 'src/sidepanel/index.html'),
      output: {
        entryFileNames: 'sidepanel.js',
        assetFileNames: 'sidepanel.[ext]',
      },
    },
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
});
