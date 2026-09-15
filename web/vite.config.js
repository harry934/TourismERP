import { defineConfig } from 'vite';
import { resolve } from 'path';
import { viteSingleFile } from 'vite-plugin-singlefile';

export default defineConfig({
  root: resolve(__dirname, 'src'),
  base: './',
  plugins: [viteSingleFile()],
  server: {
    host: true,
    port: 3000
  },
  build: {
    outDir: resolve(__dirname, 'dist'),
    emptyOutDir: true,
    assetsInlineLimit: 100000000,
    cssCodeSplit: false,
    modulePreload: false
  }
});
